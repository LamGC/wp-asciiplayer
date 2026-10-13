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
	// The mount point owns only the player. Captions must stay outside it so
	// upstream disposal/reinitialization cannot remove author-written content.
	$mount_style = $style;
	$figure_style = '';
	if ( $block ) {
		// Keep height and other legacy player-container declarations on the
		// mount point. Only width moves to the figure, so captions add height.
		if ( preg_match_all( '/(?:^|;)\s*width\s*:\s*([^;]+)/i', $style, $widths ) ) {
			$figure_style = 'width:' . end( $widths[1] ) . ';';
		}
		$mount_style = trim( preg_replace( '/(^|;)\s*width\s*:[^;]*/i', '$1', $style ), '; ' );
	}
	$player = sprintf(
		'<div class="asciiplayer-container"%1$s data-ap-src="%2$s" data-ap-options="%3$s"></div>',
		'' !== $mount_style ? ' style="' . esc_attr( $mount_style ) . '"' : '',
		esc_url( $source, array( 'http', 'https' ) ),
		esc_attr( $options )
	);
	if ( ! $block ) {
		return $player;
	}
	$alignment = isset( $attributes['displayAlign'] ) && in_array( $attributes['displayAlign'], array( 'left', 'center', 'right' ), true ) ? $attributes['displayAlign'] : 'center';
	$wrapper = get_block_wrapper_attributes( array( 'class' => 'asciiplayer-block' ) );
	$figure = 'class="asciiplayer-figure asciiplayer-align-' . esc_attr( $alignment ) . '"' . ( '' !== $figure_style ? ' style="' . esc_attr( $figure_style ) . '"' : '' );
	// RichText emits escaped text and line breaks. No other markup is needed.
	$caption = isset( $attributes['caption'] ) ? wp_kses( (string) $attributes['caption'], array( 'br' => array() ) ) : '';
	return '<div ' . $wrapper . '><figure ' . $figure . '>' . $player . ( '' !== trim( $caption ) ? '<figcaption class="wp-element-caption">' . $caption . '</figcaption>' : '' ) . '</figure></div>';
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
