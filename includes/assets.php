<?php
/**
 * Locally bundled, shared player assets and block registration.
 *
 * @package LamGC\Asciiplayer
 */

namespace LamGC\Asciiplayer;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the block, shortcode and all plugin-scoped asset handles.
 *
 * @return void
 */
function register_plugin() {
	$base  = plugin_dir_url( PLUGIN_FILE ) . 'build/';
	$asset = array(
		'dependencies' => array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n' ),
		'version'      => VERSION,
	);
	if ( file_exists( dirname( PLUGIN_FILE ) . '/build/index.asset.php' ) ) {
		$asset = require dirname( PLUGIN_FILE ) . '/build/index.asset.php';
	}

	$view_asset = array( 'dependencies' => array( 'wp-i18n' ), 'version' => VERSION );
	if ( file_exists( dirname( PLUGIN_FILE ) . '/build/view.asset.php' ) ) {
		$view_asset = require dirname( PLUGIN_FILE ) . '/build/view.asset.php';
	}

	wp_register_script( 'lamgc-asciiplayer-player', $base . 'player.js', array(), VERSION, true );
	wp_register_script(
		'lamgc-asciiplayer-view',
		$base . 'view.js',
		array_unique( array_merge( $view_asset['dependencies'], array( 'lamgc-asciiplayer-player' ) ) ),
		$view_asset['version'],
		true
	);
	wp_register_script(
		'lamgc-asciiplayer-editor',
		$base . 'index.js',
		array_unique( array_merge( $asset['dependencies'], array( 'lamgc-asciiplayer-player' ) ) ),
		$asset['version'],
		true
	);
	wp_register_style( 'lamgc-asciiplayer-player-style', $base . 'player.css', array(), VERSION );
	wp_register_style( 'lamgc-asciiplayer-style', $base . 'style-index.css', array( 'lamgc-asciiplayer-player-style' ), VERSION );
	wp_register_style( 'lamgc-asciiplayer-editor-style', $base . 'index.css', array( 'lamgc-asciiplayer-player-style' ), VERSION );

	wp_add_inline_script(
		'lamgc-asciiplayer-editor',
		'window.wpAsciiplayerSettings = ' . wp_json_encode(
			array(
				'playerScriptUrl' => add_query_arg( 'ver', VERSION, $base . 'player.js' ),
				'playerStyleUrl'  => add_query_arg( 'ver', VERSION, $base . 'player.css' ),
			),
			JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
		) . ';',
		'before'
	);
	wp_set_script_translations( 'lamgc-asciiplayer-view', 'wp-asciiplayer', dirname( PLUGIN_FILE ) . '/languages' );
	wp_set_script_translations( 'lamgc-asciiplayer-editor', 'wp-asciiplayer', dirname( PLUGIN_FILE ) . '/languages' );

	register_block_type( dirname( PLUGIN_FILE ) . '/build', array( 'render_callback' => __NAMESPACE__ . '\\render_block' ) );
	add_shortcode( SHORTCODE, __NAMESPACE__ . '\\render_shortcode' );
}

/**
 * Enqueue in the shared renderer as well, for widgets and template calls.
 * WordPress deduplicates handles across any number of players on a page.
 *
 * @return void
 */
function enqueue_player_assets() {
	wp_enqueue_script( 'lamgc-asciiplayer-view' );
	wp_enqueue_style( 'lamgc-asciiplayer-style' );
}

/**
 * Look ahead before the head is printed, including Pages and archive results.
 * Render-time enqueueing remains the source of truth for indirect content.
 *
 * @return void
 */
function enqueue_content_assets() {
	global $wp_query;
	if ( empty( $wp_query->posts ) || ! is_array( $wp_query->posts ) ) {
		return;
	}
	foreach ( $wp_query->posts as $post ) {
		if ( ! is_object( $post ) || ! isset( $post->post_content ) ) {
			continue;
		}
		if ( has_shortcode( $post->post_content, SHORTCODE ) || has_block( 'lamgc/asciiplayer', $post->post_content ) ) {
			enqueue_player_assets();
			return;
		}
	}
}

/**
 * Print only our late-enqueued CSS, before footer scripts initialize players.
 * This covers dynamically rendered shortcodes in widgets and classic themes.
 *
 * @return void
 */
function print_late_styles() {
	if ( wp_style_is( 'lamgc-asciiplayer-style', 'enqueued' ) && ! wp_style_is( 'lamgc-asciiplayer-style', 'done' ) ) {
		wp_print_styles( array( 'lamgc-asciiplayer-style' ) );
	}
}
