<?php
/** Upload validation contracts. Included by run.php after its assertion helpers. */

use function LamGC\Asciiplayer\allow_cast_upload_mime;
use function LamGC\Asciiplayer\check_cast_filetype;
use function LamGC\Asciiplayer\is_valid_cast_file;
use function LamGC\Asciiplayer\validate_cast_upload;

use const LamGC\Asciiplayer\CAST_MAX_BYTES;
use const LamGC\Asciiplayer\CAST_MAX_EVENTS;
use const LamGC\Asciiplayer\CAST_MAX_LINE_BYTES;
use const LamGC\Asciiplayer\CAST_MAX_V1_BYTES;
use const LamGC\Asciiplayer\CAST_MIME;

function cast_contents_are_valid( $contents ) {
	$path = tempnam( sys_get_temp_dir(), 'ap-cast-' );
	try {
		file_put_contents( $path, $contents );
		return is_valid_cast_file( $path );
	} finally {
		unlink( $path );
	}
}

$required_filters = array(
	'upload_mimes'                 => array( 'LamGC\\Asciiplayer\\allow_cast_upload_mime', 2 ),
	'wp_check_filetype_and_ext'     => array( 'LamGC\\Asciiplayer\\check_cast_filetype', 5 ),
	'wp_handle_upload_prefilter'   => array( 'LamGC\\Asciiplayer\\validate_cast_upload', 1 ),
	'wp_handle_sideload_prefilter' => array( 'LamGC\\Asciiplayer\\validate_cast_upload', 1 ),
);
foreach ( $GLOBALS['ap_test']['filters'] ?? array() as $filter ) {
	if ( isset( $required_filters[ $filter[0] ] ) ) {
		same( $required_filters[ $filter[0] ][0], $filter[1], 'Upload hook uses the intended callback.' );
		same( $required_filters[ $filter[0] ][1], $filter[3], 'Upload hook receives all required arguments.' );
		same( true, is_callable( $filter[1] ), 'Upload callback is callable.' );
		unset( $required_filters[ $filter[0] ] );
	}
}
same( array(), $required_filters, 'All safe-upload hooks are registered.' );

$mimes = array( 'jpg|jpeg' => 'image/jpeg', 'txt' => 'text/plain' );
same( $mimes, allow_cast_upload_mime( $mimes ), 'Anonymous/non-uploaders get no extra MIME permissions.' );
$GLOBALS['ap_test']['capabilities'] = array( 'upload_files' => true );
same( array_merge( $mimes, array( 'cast' => CAST_MIME ) ), allow_cast_upload_mime( $mimes ), 'Only .cast receives the canonical MIME.' );
same( $mimes, allow_cast_upload_mime( $mimes, 42 ), 'Explicit non-uploading user does not inherit current user permissions.' );
$GLOBALS['ap_test']['user_capabilities'][42] = array( 'upload_files' => true );
same( CAST_MIME, allow_cast_upload_mime( $mimes, 42 )['cast'], 'An explicit eligible user can upload casts.' );
$GLOBALS['ap_test']['multisite'] = true;
$GLOBALS['ap_test']['site_options']['upload_filetypes'] = 'jpg jpeg txt';
same( $mimes, allow_cast_upload_mime( $mimes ), 'Multisite network extension restrictions remain in effect.' );
$GLOBALS['ap_test']['site_options']['upload_filetypes'] = "jpg\ncast txt";
same( CAST_MIME, allow_cast_upload_mime( $mimes )['cast'], 'Network-authorized cast uploads are available.' );
$GLOBALS['ap_test']['multisite'] = false;

$v2 = '{"version":2,"width":80,"height":24}';
$v3 = '{"version":3,"term":{"cols":100,"rows":30}}';
$v1 = array( 'version' => 1, 'width' => 80, 'height' => 24, 'duration' => 1.5, 'stdout' => array( array( 0.1, "Hello\r\n" ), array( 1.4, 'World' ) ) );
foreach ( array(
	'pretty v1' => json_encode( $v1, JSON_PRETTY_PRINT ),
	'v2 output' => $v2 . "\n[0.1,\"o\",\"Hello\\r\\n\"]\n",
	'v3 relative events' => $v3 . "\n[5,\"o\",\"Hello\"]\n[0.1,\"r\",\"120x40\"]\n[0,\"x\",\"0\"]\n",
	'v3 comments' => $v3 . "\n# comment before events\n[0,\"o\",\"ok\"]\n# trailing comment\n",
	'v2 input markers resize extensions' => $v2 . "\n[0,\"i\",\"x\"]\n[0,\"m\",\"A\"]\n[1,\"r\",\"90x25\"]\n[1,\"future\",\"data\"]",
	'CRLF' => $v2 . "\r\n[0,\"o\",\"hello\"]\r\n",
	'header only' => $v2,
	'unknown header fields' => '{"version":2,"width":80,"height":24,"future":{"key":true}}' . "\n[0,\"o\",\"ok\"]\n",
	'literal terminal markup' => $v2 . "\n[0,\"o\",\"<script> is plain terminal output</script>\"]\n",
) as $description => $contents ) {
	same( true, cast_contents_are_valid( $contents ), 'Accept valid ' . $description . '.' );
}
same( true, is_valid_cast_file( dirname( __DIR__ ) . '/fixtures/hello.cast' ), 'Accept repository hello recording.' );
same( true, is_valid_cast_file( dirname( __DIR__ ) . '/fixtures/resize.cast' ), 'Accept repository resize recording.' );

foreach ( array(
	'empty' => '',
	'plain text' => 'Hello world',
	'JSON object' => '{"message":"arbitrary JSON"}',
	'JSON list' => '[1,2,3]',
	'HTML' => '<!doctype html><script>alert(1)</script>',
	'SVG' => '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
	'unsupported version' => '{"version":4,"width":80,"height":24}',
	'string version' => '{"version":"2","width":80,"height":24}',
	'zero width' => '{"version":2,"width":0,"height":24}',
	'oversized width' => '{"version":2,"width":1001,"height":24}',
	'negative height' => '{"version":2,"width":80,"height":-1}',
	'fractional width' => '{"version":2,"width":80.5,"height":24}',
	'string width' => '{"version":2,"width":"80","height":24}',
	'v3 old dimensions' => '{"version":3,"width":80,"height":24}',
	'v3 terminal array' => '{"version":3,"term":[100,30]}',
	'v1 absent stdout' => "{\n\"version\":1,\"width\":80,\"height\":24\n}",
	'v1 stdout object' => "{\n\"version\":1,\"width\":80,\"height\":24,\"stdout\":{\"0\":[0,\"x\"]}\n}",
	'compact v1 unsupported by bundled player' => json_encode( $v1 ),
	'large compact v1 unsupported by bundled player' => json_encode( array_merge( $v1, array( 'title' => str_repeat( 'a', CAST_MAX_LINE_BYTES + 1 ) ) ) ),
	'v1 negative delay' => json_encode( array_merge( $v1, array( 'stdout' => array( array( -1, 'x' ) ) ) ), JSON_PRETTY_PRINT ),
	'v1 malformed later frame' => json_encode( array_merge( $v1, array( 'stdout' => array( array( 0, 'ok' ), array( 0, array( 'x' ) ) ) ) ), JSON_PRETTY_PRINT ),
	'v1 extra frame element' => json_encode( array_merge( $v1, array( 'stdout' => array( array( 0, 'ok', 'extra' ) ) ) ), JSON_PRETTY_PRINT ),
	'v1 bad duration' => json_encode( array_merge( $v1, array( 'duration' => '1' ) ), JSON_PRETTY_PRINT ),
	'negative event time' => $v2 . "\n[-1,\"o\",\"bad\"]\n",
	'string event time' => $v2 . "\n[\"0\",\"o\",\"bad\"]\n",
	'boolean event time' => $v2 . "\n[false,\"o\",\"bad\"]\n",
	'infinite time' => $v2 . "\n[1e999,\"o\",\"bad\"]\n",
	'milliseconds overflow' => $v2 . "\n[1e308,\"o\",\"bad\"]\n",
	'v3 cumulative milliseconds overflow' => $v3 . "\n[1e305,\"o\",\"first\"]\n[1e305,\"o\",\"second\"]\n",
	'v2 out of order' => $v2 . "\n[2,\"o\",\"first\"]\n[1,\"o\",\"second\"]\n",
	'event object' => $v2 . "\n{\"0\":0,\"1\":\"o\",\"2\":\"bad\"}\n",
	'missing event data' => $v2 . "\n[0,\"o\"]\n",
	'extra event element' => $v2 . "\n[0,\"o\",\"bad\",1]\n",
	'event data array' => $v2 . "\n[0,\"o\",[\"bad\"]]\n",
	'empty event type' => $v2 . "\n[0,\"\",\"bad\"]\n",
	'zero resize' => $v2 . "\n[0,\"r\",\"0x20\"]\n",
	'oversized resize' => $v2 . "\n[0,\"r\",\"2000x20\"]\n",
	'malformed resize' => $v2 . "\n[0,\"r\",\"80,24\"]\n",
	'bad later JSON' => $v2 . "\n[0,\"o\",\"ok\"]\n[1,\"o\",\"truncated\"\n",
	'trailing HTML' => $v2 . "\n[0,\"o\",\"ok\"]\n<script>alert(1)</script>\n",
	'trailing JSON object' => $v2 . "\n[0,\"o\",\"ok\"]\n{\"unrelated\":true}\n",
	'blank event line' => $v2 . "\n\n",
	'indented event ignored by bundled player' => $v2 . "\n [0,\"o\",\"invisible\"]\n",
	'v2 comment' => $v2 . "\n# comment\n",
	'v3 indented comment' => $v3 . "\n # not a comment\n",
	'UTF-8 BOM' => "\xef\xbb\xbf" . $v2,
	'invalid UTF-8' => $v2 . "\n[0,\"o\",\"\xff\"]\n",
	'oversized JSONL line' => $v2 . "\n[0,\"o\",\"" . str_repeat( 'a', CAST_MAX_LINE_BYTES ) . "\"]\n",
	'oversized comment line' => $v3 . "\n#" . str_repeat( 'a', CAST_MAX_LINE_BYTES ) . "\n",
	'deep JSON' => $v2 . "\n[0,\"o\"," . str_repeat( '[', 20 ) . '0' . str_repeat( ']', 20 ) . "]\n",
) as $description => $contents ) {
	same( false, cast_contents_are_valid( $contents ), 'Reject ' . $description . '.' );
}
same( false, is_valid_cast_file( dirname( __DIR__ ) . '/fixtures/malformed.cast' ), 'Reject repository malformed recording.' );
same( false, is_valid_cast_file( '/does-not-exist/asciicast.cast' ), 'Reject missing files.' );
same( false, is_valid_cast_file( __DIR__ ), 'Reject directories.' );
same( false, is_valid_cast_file( 'data://text/plain,' . $v2 ), 'Reject stream wrappers before opening.' );
same( false, is_valid_cast_file( null ), 'Reject missing temporary upload path.' );
same( true, cast_contents_are_valid( $v2 . "\n" . str_repeat( "[0,\"o\",\"x\"]\n", CAST_MAX_EVENTS ) ), 'Accept the documented event-count boundary.' );
same( false, cast_contents_are_valid( $v2 . "\n" . str_repeat( "[0,\"o\",\"x\"]\n", CAST_MAX_EVENTS + 1 ) ), 'Reject excessive event count.' );
same( false, cast_contents_are_valid( json_encode( array_merge( $v1, array( 'title' => str_repeat( 'a', CAST_MAX_V1_BYTES ) ) ), JSON_PRETTY_PRINT ) ), 'Bound whole-document legacy decoding.' );

$path = tempnam( sys_get_temp_dir(), 'ap-cast-' );
try {
	$handle = fopen( $path, 'wb' );
	ftruncate( $handle, CAST_MAX_BYTES + 1 );
	fclose( $handle );
	same( false, is_valid_cast_file( $path ), 'Reject files over the byte limit before reading their contents.' );
	file_put_contents( $path, $v2 . "\n[0,\"o\",\"ok\"]\n" );
	clearstatcache( true, $path );
	$upload = array( 'name' => 'recording.cast', 'tmp_name' => $path, 'error' => 0, 'type' => 'text/plain', 'size' => 1 );
	same( $upload, validate_cast_upload( $upload ), 'Valid content passes without trusting or changing browser MIME or size.' );
	$denied = array( 'ext' => false, 'type' => false, 'proper_filename' => false );
	$approved = array( 'ext' => 'cast', 'type' => CAST_MIME, 'proper_filename' => false );
	foreach ( array( 'text/plain', 'application/json', 'application/octet-stream', false ) as $detected_mime ) {
		same( $approved, check_cast_filetype( $denied, $path, 'recording.cast', null, $detected_mime ), 'Content validation safely handles generic fileinfo guesses.' );
	}
	same( $approved, check_cast_filetype( $denied, $path, 'recording.CAST' ), 'Uppercase cast extension is supported.' );
	same( $denied, check_cast_filetype( $denied, $path, 'recording.cast', array() ), 'An explicitly empty MIME allow-list stays empty.' );
	same( $denied, check_cast_filetype( $denied, $path, 'recording.cast', array( 'txt' => 'text/plain' ) ), 'An explicit MIME allow-list excluding cast remains restricted.' );
	same( $denied, check_cast_filetype( $denied, $path, 'recording.cast', array( 'cast' => 'text/plain' ) ), 'Only our canonical allowed type can receive the MIME override.' );
	$GLOBALS['ap_test']['allowed_mimes'] = array( 'txt' => 'text/plain' );
	same( $denied, check_cast_filetype( $denied, $path, 'recording.cast', array( 'cast' => CAST_MIME ) ), 'An explicit allow-list cannot bypass a later global MIME restriction.' );
	same( true, is_string( validate_cast_upload( $upload )['error'] ), 'Prefilter also preserves later global MIME restrictions.' );
	unset( $GLOBALS['ap_test']['allowed_mimes'] );
	$unrelated = array( 'ext' => 'svg', 'type' => 'image/svg+xml', 'proper_filename' => 'x.svg' );
	foreach ( array( 'x.json', 'x.html', 'x.svg', 'x.cast.php', "x.cast\n" ) as $filename ) {
		same( $unrelated, check_cast_filetype( $unrelated, $path, $filename ), 'Other extensions and double-extension executables remain untouched.' );
	}
	same( true, is_string( validate_cast_upload( array_merge( $upload, array( 'tmp_name' => '/missing' ) ) )['error'] ), 'Missing temporary upload fails closed.' );
	$GLOBALS['ap_test']['capabilities'] = array();
	same( true, is_string( validate_cast_upload( $upload )['error'] ), 'Upload permissions are enforced for valid content too.' );
	same( $denied, check_cast_filetype( $approved, $path, 'recording.cast' ), 'MIME override never grants upload capability.' );
	$GLOBALS['ap_test']['capabilities'] = array( 'upload_files' => true, 'unfiltered_upload' => true );
	file_put_contents( $path, $v2 . "\n<script>alert(1)</script>\n" );
	clearstatcache( true, $path );
	same( true, is_string( validate_cast_upload( $upload )['error'] ), 'Malformed content fails even with unfiltered_upload.' );
	same( $denied, check_cast_filetype( $approved, $path, 'recording.cast' ), 'Invalid content cannot keep a previous MIME approval.' );
	$other_upload = array_merge( $upload, array( 'name' => 'ordinary.txt' ) );
	same( $other_upload, validate_cast_upload( $other_upload ), 'Other extensions keep core upload behavior.' );
	$existing_error = array_merge( $upload, array( 'error' => 'Rejected by another plugin.' ) );
	same( $existing_error, validate_cast_upload( $existing_error ), 'Existing upload errors are preserved.' );
	$php_error = array_merge( $upload, array( 'error' => 3 ) );
	same( $php_error, validate_cast_upload( $php_error ), 'PHP partial-upload errors are preserved.' );
} finally {
	unlink( $path );
}

unset( $GLOBALS['ap_test']['capabilities'], $GLOBALS['ap_test']['user_capabilities'], $GLOBALS['ap_test']['multisite'], $GLOBALS['ap_test']['site_options'], $GLOBALS['ap_test']['allowed_mimes'] );
