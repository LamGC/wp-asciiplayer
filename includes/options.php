<?php
/**
 * Validation shared by the shortcode and dynamic block.
 *
 * @package LamGC\Asciiplayer
 */

namespace LamGC\Asciiplayer;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Normalize shortcode's lowercase names, camelCase block names and old aliases.
 * Unknown options are intentionally discarded before reaching the player.
 *
 * @param mixed $attributes Input attributes.
 * @return array
 */
function normalize_attributes( $attributes ) {
	if ( ! is_array( $attributes ) ) {
		return array();
	}

	$aliases = array(
		'source'             => 'source',
		'src'                => 'source',
		'autoplay'           => 'autoPlay',
		'preload'            => 'preload',
		'loop'               => 'loop',
		'controls'           => 'controls',
		'fit'                => 'fit',
		'theme'              => 'theme',
		'speed'              => 'speed',
		'startat'            => 'startAt',
		'idletimelimit'      => 'idleTimeLimit',
		'cols'               => 'cols',
		'rows'               => 'rows',
		'fontsize'           => 'terminalFontSize',
		'terminalfontsize'   => 'terminalFontSize',
		'fontfamily'         => 'terminalFontFamily',
		'terminalfontfamily' => 'terminalFontFamily',
		'lineheight'         => 'terminalLineHeight',
		'terminallineheight' => 'terminalLineHeight',
		'poster'             => 'poster',
		'width'              => 'width',
		'style'              => 'legacyStyle',
		'legacystyle'        => 'legacyStyle',
	);

	$result = array();
	foreach ( $attributes as $key => $value ) {
		if ( ! is_string( $key ) || ! is_scalar( $value ) ) {
			continue;
		}
		$key = strtolower( str_replace( array( '-', '_' ), '', $key ) );
		if ( isset( $aliases[ $key ] ) ) {
			$result[ $aliases[ $key ] ] = $value;
		}
	}
	return $result;
}

/**
 * Accept HTTP(S) and site-root-relative recordings, never executable schemes.
 * No requests are made by PHP, and URL credentials are never emitted.
 *
 * @param mixed $source Recording URL.
 * @return string Sanitized URL, or an empty string for invalid input.
 */
function sanitize_source( $source ) {
	if ( ! is_string( $source ) ) {
		return '';
	}
	$source = trim( html_entity_decode( $source, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
	if ( '' === $source || preg_match( '/[\x00-\x20\x7f<>"\\\\]/', $source ) ) {
		return '';
	}

	$parts = wp_parse_url( $source );
	if ( false === $parts || ! is_array( $parts ) || isset( $parts['user'] ) || isset( $parts['pass'] ) ) {
		return '';
	}

	if ( '/' === substr( $source, 0, 1 ) ) {
		// Reject protocol-relative URLs, including slash/backslash variants.
		if ( '/' === substr( $source, 1, 1 ) || isset( $parts['host'] ) || isset( $parts['scheme'] ) ) {
			return '';
		}
	} elseif ( empty( $parts['host'] ) || empty( $parts['scheme'] ) || ! in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true ) ) {
		return '';
	}

	return esc_url_raw( $source, array( 'http', 'https' ) );
}

/**
 * Parse explicit false values rather than casting a nonempty string to true.
 *
 * @param mixed $value Input.
 * @return bool|null Null indicates an unrecognized value.
 */
function parse_boolean( $value ) {
	if ( is_bool( $value ) ) {
		return $value;
	}
	if ( ! is_scalar( $value ) ) {
		return null;
	}
	$value = strtolower( trim( (string) $value ) );
	if ( in_array( $value, array( '1', 'true', 'yes', 'on' ), true ) ) {
		return true;
	}
	if ( in_array( $value, array( '0', 'false', 'no', 'off' ), true ) ) {
		return false;
	}
	return null;
}

/**
 * Validate a finite number, retaining legitimate zero values.
 *
 * @param mixed $value Input.
 * @param float $min Minimum value.
 * @param float $max Maximum value.
 * @return float|null
 */
function parse_number( $value, $min, $max ) {
	if ( is_bool( $value ) || ! is_scalar( $value ) || ! is_numeric( $value ) ) {
		return null;
	}
	$value = (float) $value;
	return is_finite( $value ) && $value >= $min && $value <= $max ? $value : null;
}

/**
 * Convert the player's supported timecode syntax to seconds.
 *
 * @param mixed $value Seconds, mm:ss or hh:mm:ss.
 * @return float|null
 */
function parse_time( $value ) {
	$number = parse_number( $value, 0, PHP_INT_MAX );
	if ( null !== $number ) {
		return $number;
	}
	if ( ! is_string( $value ) || ! preg_match( '/^\d+(?::[0-5]?\d){1,2}(?:\.\d+)?$/', trim( $value ) ) ) {
		return null;
	}
	$total = 0.0;
	foreach ( explode( ':', trim( $value ) ) as $part ) {
		$total = $total * 60 + (float) $part;
	}
	return is_finite( $total ) && $total <= PHP_INT_MAX ? $total : null;
}

/**
 * Return a single safe CSS length for width/font size.
 *
 * @param mixed $value Input.
 * @param bool  $font Whether player font-size names are allowed.
 * @return string
 */
function sanitize_size( $value, $font = false ) {
	if ( ! is_string( $value ) && ! is_numeric( $value ) ) {
		return '';
	}
	$value = strtolower( trim( (string) $value ) );
	if ( $font && in_array( $value, array( 'small', 'medium', 'big' ), true ) ) {
		return $value;
	}
	return preg_match( '/^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|%|em|rem|vw|vh|vmin|vmax|ch))$/', $value ) ? $value : '';
}

/**
 * Produce only typed, supported player options; never JavaScript source.
 *
 * @param array $attributes Normalized attributes.
 * @return array
 */
function player_options( array $attributes ) {
	$options = array(
		'autoPlay' => false,
		'preload'  => true,
		'fit'      => 'width',
	);

	foreach ( array( 'autoPlay', 'preload', 'loop' ) as $name ) {
		if ( isset( $attributes[ $name ] ) ) {
			$value = parse_boolean( $attributes[ $name ] );
			if ( null !== $value ) {
				$options[ $name ] = $value;
			} elseif ( 'loop' === $name ) {
				// Older shortcodes can specify a finite number of replays.
				$value = parse_number( $attributes[ $name ], 1, 10000 );
				if ( null !== $value && floor( $value ) === $value ) {
					$options[ $name ] = (int) $value;
				}
			}
		}
	}

	if ( isset( $attributes['controls'] ) ) {
		$value = strtolower( trim( (string) $attributes['controls'] ) );
		if ( 'auto' === $value ) {
			$options['controls'] = 'auto';
		} elseif ( in_array( $value, array( 'always', 'never' ), true ) ) {
			$options['controls'] = 'always' === $value;
		} else {
			$value = parse_boolean( $attributes['controls'] );
			if ( null !== $value ) {
				$options['controls'] = $value;
			}
		}
	}

	if ( isset( $attributes['fit'] ) ) {
		$value = strtolower( trim( (string) $attributes['fit'] ) );
		if ( in_array( $value, array( 'width', 'height', 'both', 'none' ), true ) ) {
			$options['fit'] = $value;
		} elseif ( false === parse_boolean( $attributes['fit'] ) ) {
			$options['fit'] = 'none';
		}
	}

	if ( isset( $attributes['theme'] ) && preg_match( '/^(?:auto\/)?[a-zA-Z0-9_-]{1,64}$/', (string) $attributes['theme'] ) ) {
		$options['theme'] = (string) $attributes['theme'];
	}

	foreach ( array( 'speed' => array( 0.01, 100 ), 'idleTimeLimit' => array( 0.001, PHP_INT_MAX ), 'terminalLineHeight' => array( 0.1, 10 ) ) as $name => $range ) {
		if ( isset( $attributes[ $name ] ) ) {
			$value = parse_number( $attributes[ $name ], $range[0], $range[1] );
			if ( null !== $value ) {
				$options[ $name ] = $value;
			}
		}
	}

	if ( isset( $attributes['startAt'] ) ) {
		$value = parse_time( $attributes['startAt'] );
		if ( null !== $value ) {
			$options['startAt'] = $value;
		}
	}

	foreach ( array( 'cols', 'rows' ) as $name ) {
		if ( isset( $attributes[ $name ] ) ) {
			$value = parse_number( $attributes[ $name ], 1, 1000 );
			if ( null !== $value && floor( $value ) === $value ) {
				$options[ $name ] = (int) $value;
			}
		}
	}

	if ( isset( $attributes['terminalFontSize'] ) ) {
		$value = sanitize_size( $attributes['terminalFontSize'], true );
		if ( '' !== $value ) {
			$options['terminalFontSize'] = $value;
		}
	}

	if ( isset( $attributes['terminalFontFamily'] ) ) {
		$value = trim( (string) $attributes['terminalFontFamily'] );
		if ( strlen( $value ) <= 300 && preg_match( '/^[a-zA-Z0-9 _.,\'"-]+$/', $value ) ) {
			$options['terminalFontFamily'] = $value;
		}
	}

	if ( isset( $attributes['poster'] ) ) {
		$value = (string) $attributes['poster'];
		if ( 0 === strpos( $value, 'npt:' ) && null !== parse_time( substr( $value, 4 ) ) ) {
			$options['poster'] = $value;
		} elseif ( 0 === strpos( $value, 'data:text/plain,' ) && strlen( $value ) <= 32768 ) {
			$options['poster'] = $value;
		}
	}

	return $options;
}

/**
 * Filter legacy inline style, then apply the dedicated width control if set.
 *
 * @param array $attributes Normalized attributes.
 * @return string
 */
function player_style( array $attributes ) {
	$style = isset( $attributes['legacyStyle'] ) ? safecss_filter_attr( (string) $attributes['legacyStyle'] ) : '';
	if ( isset( $attributes['width'] ) ) {
		$width = sanitize_size( $attributes['width'] );
		if ( '' !== $width ) {
			$style = rtrim( $style, '; ' ) . ';width:' . $width . ';';
		}
	}
	return ltrim( $style, '; ' );
}
