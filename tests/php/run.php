<?php
/** Run with PHP 7.4+: php tests/php/run.php */

require __DIR__ . '/bootstrap.php';

use function LamGC\Asciiplayer\enqueue_content_assets;
use function LamGC\Asciiplayer\normalize_attributes;
use function LamGC\Asciiplayer\parse_boolean;
use function LamGC\Asciiplayer\parse_number;
use function LamGC\Asciiplayer\parse_time;
use function LamGC\Asciiplayer\player_options;
use function LamGC\Asciiplayer\player_style;
use function LamGC\Asciiplayer\print_late_styles;
use function LamGC\Asciiplayer\register_plugin;
use function LamGC\Asciiplayer\render_block;
use function LamGC\Asciiplayer\render_player;
use function LamGC\Asciiplayer\render_shortcode;
use function LamGC\Asciiplayer\sanitize_source;

$assertions = 0;
function same( $expected, $actual, $message ) {
	global $assertions;
	++$assertions;
	if ( $expected !== $actual ) {
		throw new RuntimeException( $message . '\nExpected: ' . var_export( $expected, true ) . '\nActual: ' . var_export( $actual, true ) );
	}
}
function contains( $needle, $haystack, $message ) {
	same( true, false !== strpos( $haystack, $needle ), $message );
}
function options_from( $html ) {
	if ( ! preg_match( '/ data-ap-options="([^"]*)"/', $html, $matches ) ) {
		throw new RuntimeException( 'Missing JSON data-ap-options.' );
	}
	return json_decode( html_entity_decode( $matches[1], ENT_QUOTES, 'UTF-8' ), true );
}
function reset_enqueues() {
	$GLOBALS['ap_test']['enqueued_scripts'] = array();
	$GLOBALS['ap_test']['enqueued_styles'] = array();
}

try {
	// All registration happens in init, without global option writes/collisions.
	same( 'some-other-plugin', PLUGIN_VERSION, 'No shared global version constant.' );
	same( false, function_exists( 'is_assoc' ), 'No generic global helper functions.' );
	same( 3, count( $GLOBALS['ap_test']['actions'] ), 'Register init, enqueue and late-style hooks.' );
	foreach ( $GLOBALS['ap_test']['actions'] as $action ) {
		same( true, is_callable( $action[1] ), 'Every registered callback is callable.' );
	}
	register_plugin();
	same( array( 'wp-asciiplayer', 'wp-asciiplayer/languages' ), $GLOBALS['ap_test']['textdomains'][0], 'Bundled PHP catalogs register during init.' );
	if ( file_exists( dirname( __DIR__, 2 ) . '/build/runtime.asset.php' ) ) {
		$versions = require dirname( __DIR__, 2 ) . '/build/runtime.asset.php';
		same( $versions['player.js'], $GLOBALS['ap_test']['scripts']['lamgc-asciiplayer-player']['version'], 'Player script uses its content hash.' );
		foreach ( array( 'lamgc-asciiplayer-player-style' => 'player.css', 'lamgc-asciiplayer-style' => 'style-index.css', 'lamgc-asciiplayer-editor-style' => 'index.css' ) as $handle => $file ) {
			same( $versions[ $file ], $GLOBALS['ap_test']['styles'][ $handle ]['version'], 'Each stylesheet uses its own content hash.' );
		}
	}
	same( 'asciiplayer', $GLOBALS['ap_test']['shortcodes'][0][0], 'Legacy shortcode stays registered.' );
	contains( '/build', $GLOBALS['ap_test']['blocks'][0]['path'], 'Block uses local metadata.' );
	same( 'LamGC\\Asciiplayer\\render_block', $GLOBALS['ap_test']['blocks'][0]['args']['render_callback'], 'Block is server rendered.' );
	foreach ( $GLOBALS['ap_test']['scripts'] as $script ) {
		contains( 'https://wordpress.test/wp-content/plugins/wp-asciiplayer/build/', $script['src'], 'Runtime JavaScript is locally bundled.' );
		same( true, $script['footer'], 'Scripts load in footer.' );
	}
	same( true, in_array( 'lamgc-asciiplayer-player', $GLOBALS['ap_test']['scripts']['lamgc-asciiplayer-view']['deps'], true ), 'Frontend adapter depends on local player.' );
	same( true, in_array( 'wp-i18n', $GLOBALS['ap_test']['scripts']['lamgc-asciiplayer-view']['deps'], true ), 'Frontend translations dependency registered.' );
	same( array( 'lamgc-asciiplayer-player-style' ), $GLOBALS['ap_test']['styles']['lamgc-asciiplayer-style']['deps'], 'Frontend style depends on player stylesheet.' );
	contains( 'window.wpAsciiplayerSettings = ', $GLOBALS['ap_test']['inline_scripts'][0]['source'], 'Editor iframe receives trusted runtime URLs.' );
	same( 'before', $GLOBALS['ap_test']['inline_scripts'][0]['position'], 'Settings are available before editor boot.' );
	contains( 'player.js?ver=' . $GLOBALS['ap_test']['scripts']['lamgc-asciiplayer-player']['version'], $GLOBALS['ap_test']['inline_scripts'][0]['source'], 'Bridge JavaScript cache-buster matches registered asset version.' );
	contains( 'player.css?ver=' . $GLOBALS['ap_test']['styles']['lamgc-asciiplayer-player-style']['version'], $GLOBALS['ap_test']['inline_scripts'][0]['source'], 'Bridge CSS cache-buster matches registered asset version.' );

	// Source validation covers script, HTML, credential and relative-URL attacks.
	foreach ( array( '', 'javascript:alert(1)', 'data:text/html,test', 'file:///tmp/a.cast', '//evil.test/a.cast', '/\\evil.test/a.cast', "https://example.test/a\n.cast", 'https://x.test/" onmouseover="alert(1)', 'https://user:secret@example.test/a.cast', 'https:///a.cast', 'a.cast', array( 'bad' ) ) as $source ) {
		same( '', sanitize_source( $source ), 'Reject unsafe or unsupported source.' );
	}
	foreach ( array( 'https://example.test/a.cast', 'http://example.test:8080/a.cast?x=1&y=2', '/wp-content/uploads/demo.cast', '/cast/demo.cast?x=1&y=2' ) as $source ) {
		same( $source, sanitize_source( $source ), 'Allow HTTP(S) or root-relative source.' );
	}
	same( 'https://example.test/a.cast?a=1&b=2', sanitize_source( '  https://example.test/a.cast?a=1&amp;b=2  ' ), 'Decode editor entities and trim outer whitespace.' );

	foreach ( array( false, 'false', '0', 0, 'off', 'no' ) as $value ) {
		same( false, parse_boolean( $value ), 'Explicit false remains false.' );
	}
	foreach ( array( true, 'true', '1', 1, 'on', 'yes' ) as $value ) {
		same( true, parse_boolean( $value ), 'Recognized true values.' );
	}
	same( null, parse_boolean( 'garbage' ), 'Unrecognized bool is ignored.' );
	same( null, parse_number( 'INF', 0, 100 ), 'Infinity is rejected.' );
	same( null, parse_number( true, 0, 100 ), 'Boolean is not a numeric option.' );
	same( null, parse_number( -1, 0, 100 ), 'Negative time is rejected.' );
	same( 0.0, parse_time( '0' ), 'Zero start time is retained.' );
	same( 123.0, parse_time( '2:03' ), 'Legacy mm:ss start time.' );
	same( 3723.5, parse_time( '1:02:03.5' ), 'Legacy hh:mm:ss fractional time.' );
	same( null, parse_time( '1:99' ), 'Invalid time components are rejected.' );

	$attrs = normalize_attributes( array( 'autoplay' => 'false', 'startat' => '2:03', 'idle-time-limit' => '2', 'fontSize' => '15px', 'fontfamily' => "'Fira Code', monospace", 'lineheight' => 1.4, 'logger' => 'console', 'unknown' => 'bad', 0 => 'bare', 'rows' => array( 2 ) ) );
	same( false, isset( $attrs['unknown'] ), 'Unknown attributes are discarded.' );
	same( false, isset( $attrs['logger'] ), 'No executable logger objects.' );
	same( false, isset( $attrs['rows'] ), 'Nested option values are discarded.' );
	$options = player_options( $attrs );
	same( false, $options['autoPlay'], 'Lowercase autoplay normalizes and respects false.' );
	same( 123.0, $options['startAt'], 'Lowercase startAt normalizes.' );
	same( 2.0, $options['idleTimeLimit'], 'Hyphenated idleTimeLimit normalizes.' );
	same( '15px', $options['terminalFontSize'], 'Legacy font aliases map to current player options.' );
	same( "'Fira Code', monospace", $options['terminalFontFamily'], 'Font lists survive safely.' );
	same( 1.4, $options['terminalLineHeight'], 'Legacy lineHeight maps to current name.' );
	$options = player_options( normalize_attributes( array( 'controls' => 'false', 'preload' => 'false', 'loop' => 'false', 'fit' => 'false' ) ) );
	same( false, $options['controls'], 'controls=false is a boolean, never a truthy string.' );
	same( false, $options['preload'], 'preload=false is retained.' );
	same( false, $options['loop'], 'loop=false is retained.' );
	same( 'none', $options['fit'], 'Legacy fit=false maps to none.' );
	foreach ( array( 'always' => true, 'never' => false, 'auto' => 'auto' ) as $input => $expected ) {
		same( $expected, player_options( array( 'controls' => $input ) )['controls'], 'Block control enum converts to player API.' );
	}
	same( 3, player_options( array( 'loop' => '3' ) )['loop'], 'Finite replay counts stay supported in shortcodes.' );
	$options = player_options( array( 'speed' => -1, 'idleTimeLimit' => 0, 'cols' => 4.5, 'rows' => 1001, 'startAt' => -1, 'terminalFontSize' => '12px; color:red', 'terminalFontFamily' => 'url(https://bad.test)', 'theme' => 'x" onclick=bad', 'poster' => 'javascript:alert(1)' ) );
	same( array( 'autoPlay' => false, 'preload' => true, 'fit' => 'width' ), $options, 'Invalid options omitted, safe defaults retained.' );
	same( 'auto/dracula', player_options( array( 'theme' => 'auto/dracula' ) )['theme'], 'Player theme fallback syntax retained.' );
	same( 'npt:1:23', player_options( array( 'poster' => 'npt:1:23' ) )['poster'], 'Safe NPT poster supported.' );
	same( 'data:text/plain,<Hello>', player_options( array( 'poster' => 'data:text/plain,<Hello>' ) )['poster'], 'Plain terminal-text posters are supported.' );

	reset_enqueues();
	same( '', render_shortcode( array() ), 'Unclosed/empty shortcode returns no player.' );
	same( '', render_player( array( 'source' => 'javascript:alert(1)' ) ), 'Invalid source emits no HTML.' );
	same( array(), $GLOBALS['ap_test']['enqueued_scripts'], 'Invalid source does not enqueue assets.' );
	$html = render_shortcode( array( 'controls' => 'false', 'autoPlay' => 'true', 'startAt' => '12', 'idleTimeLimit' => '2' ), 'https://example.test/demo.cast?a=1&b=2' );
	contains( 'class="asciiplayer-container"', $html, 'Render adapter class.' );
	contains( 'data-ap-src="https://example.test/demo.cast?a=1&amp;b=2"', $html, 'URL is escaped for an HTML attribute.' );
	same( false, options_from( $html )['controls'], 'Markup has typed JSON false.' );
	same( true, options_from( $html )['autoPlay'], 'CamelCase boolean handled.' );
	same( 12, options_from( $html )['startAt'], 'JSON numeric startAt.' );
	same( 2, options_from( $html )['idleTimeLimit'], 'JSON numeric idleTimeLimit.' );
	same( true, isset( $GLOBALS['ap_test']['enqueued_scripts']['lamgc-asciiplayer-view'] ), 'Every valid render requests the frontend adapter.' );
	same( true, isset( $GLOBALS['ap_test']['enqueued_styles']['lamgc-asciiplayer-style'] ), 'Every valid render requests CSS.' );
	$html = render_block( array( 'source' => '/demo.cast', 'poster' => 'data:text/plain,"><script>alert(1)</script>', 'legacyStyle' => 'width:80%;color:red;background:url(javascript:alert(1))' ) );
	same( false, false !== strpos( $html, '<script>' ), 'Poster cannot escape JSON/HTML attribute.' );
	contains( 'style="color:red"', $html, 'Legacy player styles stay on the player mount point.' );
	contains( 'style="width:80%;"', $html, 'Legacy width moves to the figure.' );
	contains( 'background:url(javascript:alert(1))', end( $GLOBALS['ap_test']['filtered_css'] ), 'The original style is supplied to the WordPress sanitizer.' );
	same( 'width:80%;height:200px;width:50%;', player_style( array( 'legacyStyle' => 'width:80%;height:200px', 'width' => '50%' ) ), 'Dedicated width control overrides legacy width.' );
	same( '', player_style( array( 'width' => '100%;background:red' ) ), 'Width cannot inject extra declarations.' );
	same( options_from( render_player( array( 'source' => '/demo.cast', 'speed' => 2 ) ) ), options_from( render_block( array( 'source' => '/demo.cast', 'speed' => 2 ) ) ), 'Block uses shared player options.' );
	same( 'asciiplayer-block', end( $GLOBALS['ap_test']['block_wrappers'] )['class'], 'Block wrapper classes/layout pass through WordPress block supports.' );

	$html = render_block( array( 'source' => '/demo.cast', 'width' => '480px', 'displayAlign' => 'right', 'caption' => 'Caption &amp; detail<br>second line' ) );
	contains( '<figure ', $html, 'Block has semantic figure wrapper.' );
	contains( 'asciiplayer-align-right', $html, 'Validated display alignment.' );
	contains( 'width:480px;', $html, 'Display width belongs to figure.' );
	contains( '<figcaption class="wp-element-caption">Caption &amp; detail<br>second line</figcaption>', $html, 'Caption is outside player mount point.' );
	contains( '</div><figcaption', $html, 'Player cannot dispose caption.' );
	$html = render_block( array( 'source' => '/demo.cast', 'displayAlign' => '\" onclick=alert(1)', 'caption' => '<img src=x onerror=alert(1)>Safe' ) );
	contains( 'asciiplayer-align-center', $html, 'Invalid alignment falls back safely.' );
	same( false, false !== strpos( $html, '<img' ), 'Caption does not allow image markup.' );
	same( false, isset( player_options( array() )['cols'] ), 'Default columns come from recording.' );
	same( false, isset( player_options( array() )['rows'] ), 'Default rows come from recording.' );
	same( 120, player_options( array( 'cols' => 120 ) )['cols'], 'Explicit column override is retained.' );
	same( false, isset( player_options( array( 'cols' => 120 ) )['rows'] ), 'One-axis override leaves other axis native.' );

	$html = render_block( array( 'source' => '/demo.cast', 'legacyStyle' => 'height:200px;width:80%', 'caption' => 'Under player' ) );
	contains( 'class="asciiplayer-container" style="height:200px"', $html, 'Legacy height remains on the player, so caption contributes to figure height.' );
	// No is_single gate: query lookahead supports Pages and archive results.
	reset_enqueues();
	$GLOBALS['wp_query'] = (object) array( 'posts' => array( (object) array( 'post_content' => 'Ordinary content' ), (object) array( 'post_content' => '[asciiplayer]/demo.cast[/asciiplayer]' ) ) );
	enqueue_content_assets();
	same( true, isset( $GLOBALS['ap_test']['enqueued_scripts']['lamgc-asciiplayer-view'] ), 'Shortcode in any queried post receives assets.' );
	reset_enqueues();
	$GLOBALS['wp_query']->posts = array( (object) array( 'post_content' => '<!-- wp:lamgc/asciiplayer {"source":"/demo.cast"} /-->' ) );
	enqueue_content_assets();
	same( true, isset( $GLOBALS['ap_test']['enqueued_scripts']['lamgc-asciiplayer-view'] ), 'Block in query receives assets.' );
	reset_enqueues();
	$GLOBALS['wp_query']->posts = array( (object) array( 'post_content' => 'No players' ), 12 );
	enqueue_content_assets();
	same( array(), $GLOBALS['ap_test']['enqueued_scripts'], 'Ordinary content does not enqueue runtime.' );
	render_shortcode( array(), '/widget.cast' );
	print_late_styles();
	print_late_styles();
	same( array( 'lamgc-asciiplayer-style' ), $GLOBALS['ap_test']['style_print_calls'], 'Late/widget styles print once in the footer.' );

	require __DIR__ . '/uploads.php';

	echo "OK: {$assertions} assertions passed.\n";
} catch ( Throwable $error ) {
	fwrite( STDERR, $error->getMessage() . "\n" );
	exit( 1 );
}
