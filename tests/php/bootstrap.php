<?php
/**
 * Minimal WordPress API doubles for focused, dependency-free plugin tests.
 * These verify plugin contracts, not the implementation of WordPress sanitizers.
 * Real WordPress/browser integration tests cover the latter separately.
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'PLUGIN_VERSION', 'some-other-plugin' );

$GLOBALS['ap_test'] = array();

function ap_record( $key, $value ) {
	$GLOBALS['ap_test'][ $key ][] = $value;
}

function add_action( $hook, $callback, $priority = 10 ) {
	ap_record( 'actions', array( $hook, $callback, $priority ) );
}
function add_shortcode( $tag, $callback ) {
	ap_record( 'shortcodes', array( $tag, $callback ) );
}
function add_option() {
	throw new RuntimeException( 'Plugin must not write options on requests.' );
}
function update_option() {
	throw new RuntimeException( 'Plugin must not write options on requests.' );
}
function plugin_dir_url( $file ) {
	return 'https://wordpress.test/wp-content/plugins/wp-asciiplayer/';
}
function add_query_arg( $key, $value, $url ) {
	return $url . ( false === strpos( $url, '?' ) ? '?' : '&' ) . rawurlencode( $key ) . '=' . rawurlencode( $value );
}
function wp_parse_url( $value ) {
	return parse_url( $value );
}
function esc_url_raw( $value, $protocols = null ) {
	return $value;
}
function esc_url( $value, $protocols = null ) {
	return htmlspecialchars( $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
}
function esc_attr( $value ) {
	return htmlspecialchars( $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
}
function get_block_wrapper_attributes( $attributes ) {
	ap_record( 'block_wrappers', $attributes );
	$output = array();
	foreach ( $attributes as $key => $value ) {
		if ( '' !== $value ) {
			$output[] = $key . '="' . esc_attr( $value ) . '"';
		}
	}
	return implode( ' ', $output );
}
function wp_kses( $value, $allowed ) {
	// Contract-only double. Actual sanitizer coverage belongs to WP browser tests.
	return strip_tags( $value, '<br>' );
}
function wp_json_encode( $value, $flags = 0 ) {
	return json_encode( $value, $flags );
}
function safecss_filter_attr( $style ) {
	ap_record( 'filtered_css', $style );
	$safe = array();
	foreach ( explode( ';', $style ) as $declaration ) {
		if ( preg_match( '/^\s*(width|height|color)\s*:\s*([a-z0-9.%# -]+)\s*$/i', $declaration ) ) {
			$safe[] = trim( $declaration );
		}
	}
	return implode( ';', $safe );
}
function wp_register_script( $handle, $src, $deps, $version, $footer ) {
	$GLOBALS['ap_test']['scripts'][ $handle ] = compact( 'src', 'deps', 'version', 'footer' );
}
function wp_register_style( $handle, $src, $deps, $version ) {
	$GLOBALS['ap_test']['styles'][ $handle ] = compact( 'src', 'deps', 'version' );
}
function wp_add_inline_script( $handle, $source, $position ) {
	ap_record( 'inline_scripts', compact( 'handle', 'source', 'position' ) );
}
function wp_set_script_translations( $handle, $domain, $path ) {
	ap_record( 'translations', compact( 'handle', 'domain', 'path' ) );
}
function register_block_type( $path, $args ) {
	ap_record( 'blocks', compact( 'path', 'args' ) );
}
function wp_enqueue_script( $handle ) {
	$GLOBALS['ap_test']['enqueued_scripts'][ $handle ] = true;
}
function wp_enqueue_style( $handle ) {
	$GLOBALS['ap_test']['enqueued_styles'][ $handle ] = true;
}
function wp_style_is( $handle, $status ) {
	return ! empty( $GLOBALS['ap_test'][ 'done' === $status ? 'printed_styles' : 'enqueued_styles' ][ $handle ] );
}
function wp_print_styles( $handles ) {
	foreach ( $handles as $handle ) {
		$GLOBALS['ap_test']['printed_styles'][ $handle ] = true;
		ap_record( 'style_print_calls', $handle );
	}
}
function has_shortcode( $content, $tag ) {
	return false !== strpos( $content, '[' . $tag );
}
function has_block( $name, $content ) {
	return false !== strpos( $content, '<!-- wp:' . $name );
}

require dirname( __DIR__, 2 ) . '/asciicast-player.php';
