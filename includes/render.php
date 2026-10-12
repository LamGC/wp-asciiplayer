<?php
/**
 * Safe, shared rendering for shortcode and block content.
 *
 * @package LamGC\Asciiplayer
 */

namespace LamGC\Asciiplayer;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Render one player. Invalid/missing sources produce no frontend markup.
 *
 * @param mixed       $attributes Player attributes.
 * @param string|null $content Optional legacy shortcode source.
 * @param bool        $block Whether WordPress block wrapper supports apply.
 * @return string
 */
function render_player( $attributes = array(), $content = null, $block = false ) {
	$attributes = normalize_attributes( $attributes );
	$source     = sanitize_source( null !== $content ? $content : ( $attributes['source'] ?? '' ) );
	if ( '' === $source ) {
		return '';
	}

	$options = wp_json_encode( player_options( $attributes ), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );
	if ( false === $options ) {
		return '';
	}

	enqueue_player_assets();
	$style   = player_style( $attributes );
	$wrapper = $block
		? get_block_wrapper_attributes( array( 'class' => 'asciiplayer-container', 'style' => $style ) )
		: 'class="asciiplayer-container"' . ( '' === $style ? '' : ' style="' . esc_attr( $style ) . '"' );
	return sprintf(
		'<div %1$s data-ap-src="%2$s" data-ap-options="%3$s"></div>',
		$wrapper,
		esc_url( $source, array( 'http', 'https' ) ),
		esc_attr( $options )
	);
}

/**
 * Preserve [asciiplayer]URL[/asciiplayer] and its existing options.
 *
 * @param mixed       $attributes Shortcode attributes.
 * @param string|null $content Enclosed URL.
 * @return string
 */
function render_shortcode( $attributes = array(), $content = null ) {
	return null === $content ? '' : render_player( $attributes, $content );
}

/**
 * Dynamic block callback. Both authoring paths use exactly the same sanitizer.
 *
 * @param array $attributes Block attributes.
 * @return string
 */
function render_block( $attributes ) {
	return render_player( $attributes, null, true );
}
