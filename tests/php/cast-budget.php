<?php
/** Resource-bound regressions; included after the existing upload contracts. */


namespace {
	use function LamGC\Asciiplayer\is_cast_json_within_budget;
	use function LamGC\Asciiplayer\is_cast_v1;
	use const LamGC\Asciiplayer\CAST_MAX_JSON_CONTAINERS;
	use const LamGC\Asciiplayer\CAST_MAX_JSON_TOKENS;

	function cast_budget_accepts( $text ) {
		$containers = 0;
		$tokens = 0;
		return is_cast_json_within_budget( $text, $containers, $tokens );
	}

	foreach ( array(
		'zero v2 dimensions' => '{"version":2,"width":0,"height":0}',
		'zero v3 dimensions' => '{"version":3,"term":{"cols":0,"rows":0}}',
		'40,000 cells' => '{"version":2,"width":1000,"height":40}',
		'normal ignored lines' => $v2 . "\n\n# comment\nnot an event\n [broken ignored JSON\n[0,\"o\",\"works\"]\n",
		'1,000 markers' => $v2 . "\n" . str_repeat( "[0,\"m\",\"mark\"]\n", 1000 ),
		'40,000-cell resize' => $v2 . "\n[0,\"r\",\"200x200\"]\n",
	) as $description => $contents ) {
		same( true, cast_contents_are_valid( $contents ), 'Accept ' . $description . '.' );
	}
	foreach ( array(
		'cell-product overflow' => '{"version":2,"width":201,"height":200}',
		'zero width defaults before cell check' => '{"version":2,"width":0,"height":501}',
		'zero height defaults before cell check' => '{"version":2,"width":1000,"height":0}' . "\n[0,\"r\",\"1000x41\"]\n",
		'v3 cell-product overflow' => '{"version":3,"term":{"cols":201,"rows":200}}',
		'1,001 markers' => $v3 . "\n" . str_repeat( "[0,\"m\",\"mark\"]\n", 1001 ),
		'resize cell-product overflow' => $v2 . "\n[0,\"r\",\"201x200\"]\n",
		'zero resize has no header defaults' => $v3 . "\n[0,\"r\",\"80x0\"]\n",
		'ignored line count overflow' => $v2 . "\n" . str_repeat( "\n", 100001 ),
		'ignored line byte overflow' => $v2 . "\n#" . str_repeat( 'x', 262144 ),
		'missing dimensions' => '{"version":2}',
		'empty malformed event' => $v2 . "\n[]\n",
	) as $description => $contents ) {
		same( false, cast_contents_are_valid( $contents ), 'Reject ' . $description . '.' );
	}

	$containers = 0;
	$tokens = 0;
	$escaped = json_encode( array( 'key"\\' => '[{}], : \\" braces', 'value' => true ) );
	same( true, is_cast_json_within_budget( " \n\t" . $escaped . "\r\n", $containers, $tokens ), 'Escapes and JSON whitespace are scanned.' );
	same( 1, $containers, 'String punctuation does not inflate containers.' );
	same( 4, $tokens, 'Keys and scalar values each consume a token.' );
	same( true, cast_budget_accepts( str_repeat( '[', 15 ) . '0' . str_repeat( ']', 15 ) ), 'Container nesting 15 fits decoder depth 16.' );
	same( false, cast_budget_accepts( str_repeat( '[', 16 ) . '0' . str_repeat( ']', 16 ) ), 'Reject depth before decoder allocation.' );
	same( true, cast_budget_accepts( '[' . str_repeat( '0,', CAST_MAX_JSON_TOKENS - 1 ) . '0]' ), 'Scalar token budget is inclusive.' );
	same( false, cast_budget_accepts( '[' . str_repeat( '0,', CAST_MAX_JSON_TOKENS ) . '0]' ), 'Reject excessive scalar tokens.' );
	same( true, cast_budget_accepts( '[' . str_repeat( '{},', CAST_MAX_JSON_CONTAINERS - 2 ) . '{}]' ), 'Container budget is inclusive.' );
	same( false, cast_budget_accepts( '[' . str_repeat( '{},', CAST_MAX_JSON_CONTAINERS - 1 ) . '{}]' ), 'Reject excessive empty containers.' );
	$containers = 0;
	$tokens = CAST_MAX_JSON_TOKENS - 2;
	same( true, is_cast_json_within_budget( '[0,"o"]', $containers, $tokens ), 'Shared record budget reaches its boundary.' );
	same( false, is_cast_json_within_budget( '[0]', $containers, $tokens ), 'Shared record budget cannot reset per event.' );

	foreach ( array(
		'wide metadata scalars' => '[' . str_repeat( '0,', CAST_MAX_JSON_TOKENS ) . '0]',
		'wide metadata containers' => '[' . str_repeat( '{},', CAST_MAX_JSON_CONTAINERS ) . '{}]',
		'duplicate metadata keys' => '{' . str_repeat( '"x":0,', 200000 ) . '"x":0}',
		'deep metadata' => str_repeat( '[', 16 ) . '0' . str_repeat( ']', 16 ),
	) as $description => $metadata ) {
		$text = "{\n\"version\":1,\"width\":80,\"height\":24,\"stdout\":[],\"metadata\":" . $metadata . '}';
		$GLOBALS['cast_decode_lengths'] = array();
		same( false, is_cast_v1( $text ), 'Reject ' . $description . ' before decoding.' );
		same( array(), $GLOBALS['cast_decode_lengths'], 'No native decode runs for ' . $description . '.' );
		same( false, cast_contents_are_valid( $text ), 'Upload path rejects ' . $description . '.' );
		same( false, in_array( strlen( $text ), $GLOBALS['cast_decode_lengths'], true ), 'Upload path never decodes the full rejected document.' );
	}
	$prefix = '{"version":2,"width":80,"height":24,"metadata":[';
	same( true, cast_contents_are_valid( $prefix . str_repeat( '0,', 19992 ) . '0]}' ), 'JSONL header accepts exactly 20,000 scalar/key tokens.' );
	same( false, cast_contents_are_valid( $prefix . str_repeat( '0,', 19993 ) . '0]}' ), 'JSONL header rejects 20,001 scalar/key tokens.' );
	foreach ( array( 2, 3 ) as $version ) {
		$prefix = 2 === $version ? '{"version":2,"width":80,"height":24,"metadata":[' : '{"version":3,"term":{"cols":80,"rows":24},"metadata":[';
		$wide_header = $prefix . str_repeat( '0,', 20000 ) . '0]}';
		$GLOBALS['cast_decode_lengths'] = array();
		same( false, cast_contents_are_valid( $wide_header ), 'Wide JSONL header is rejected without v1 budget fallback.' );
		same( false, in_array( strlen( $wide_header ), $GLOBALS['cast_decode_lengths'], true ), 'Over-budget v2/v3 header never reaches full decoder.' );
	}
	foreach ( array(
		'escaped version key' => '{"ver\\u0073ion":1,"width":80,"height":24,"stdout":[]}',
		'duplicate version last wins' => '{"version":2,"version":1,"width":80,"height":24,"stdout":[]}',
		'nested version ignored' => '{"version":1,"meta":{"version":2},"width":80,"height":24,"stdout":[]}',
		'frame-rich first line' => '{"stdout":[' . str_repeat( '[0,""],', 10000 ) . '[0,""]],'. "\n" .'"version":1,"width":80,"height":24}',
		'title-rich first line' => '{"title":"' . str_repeat( 'x', 262144 ) . '",'. "\n" .'"version":1,"width":80,"height":24,"stdout":[]}',
	) as $description => $text ) {
		same( true, cast_contents_are_valid( $text ), 'Format discriminator preserves ' . $description . '.' );
	}
	$text = '{"version":1,"version":2,"width":80,"height":24,"stdout":[],"metadata":[' . str_repeat( '0,', 20000 ) . '0]}';
	$GLOBALS['cast_decode_lengths'] = array();
	same( false, cast_contents_are_valid( $text ), 'Last duplicate version cannot receive a legacy budget.' );
	same( false, in_array( strlen( $text ), $GLOBALS['cast_decode_lengths'], true ), 'Last duplicate version rejects before full decode.' );

	$wide_event = '[0,"o",[' . str_repeat( '0,', 19999 ) . '0]]';
	$GLOBALS['cast_decode_lengths'] = array();
	same( false, cast_contents_are_valid( $v2 . "\n" . $wide_event ), 'Reject wide event data with the per-line gate.' );
	same( false, in_array( strlen( $wide_event ), $GLOBALS['cast_decode_lengths'], true ), 'Wide event never reaches the native decoder.' );
	$deep_header = '{"version":2,"width":80,"height":24,"metadata":' . str_repeat( '[', 14 ) . '0' . str_repeat( ']', 14 ) . '}';
	same( true, cast_contents_are_valid( $deep_header ), 'Decoder and lexical gate agree on depth boundary.' );

	$GLOBALS['cast_decode_lengths'] = array();
	same( false, is_cast_v1( '{"version":1,broken}' ), 'Final decoder still rejects malformed JSON.' );
	same( true, in_array( strlen( '{"version":1,broken}' ), $GLOBALS['cast_decode_lengths'], true ), 'Within-budget grammar errors reach the real decoder.' );
	$text = '{"version":1,"width":0,"height":0,"stdout":[' . str_repeat( '[0,""],', 99999 ) . '[0,""]]}';
	same( true, cast_contents_are_valid( $text ), '100,000 compact v1 frames fit byte, structure and event budgets.' );
	$GLOBALS['cast_decode_lengths'] = array();
}
