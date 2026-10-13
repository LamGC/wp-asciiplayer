<?php
/**
 * Extension-scoped, content-validated Media Library support for asciicast files.
 *
 * @package LamGC\Asciiplayer
 */

namespace LamGC\Asciiplayer;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const CAST_MIME = 'application/x-asciicast';
const CAST_MAX_BYTES = 33554432; // 32 MiB; WordPress/server upload limits still apply.
const CAST_MAX_LINE_BYTES = 262144; // Bound individual JSON decodes to 256 KiB.
const CAST_MAX_V1_BYTES = 2097152; // Legacy v1 is a single JSON document, not a stream.
const CAST_MAX_EVENTS = 100000;
const CAST_MAX_DIMENSION = 1000;

/** Whether this user and, on multisite, the network permit .cast uploads. */
function can_upload_cast( $user = null ) {
	$allowed = null === $user ? current_user_can( 'upload_files' ) : user_can( $user, 'upload_files' );
	if ( ! $allowed ) {
		return false;
	}
	if ( is_multisite() ) {
		$extensions = preg_split( '/\s+/', strtolower( (string) get_site_option( 'upload_filetypes', '' ) ) );
		return in_array( 'cast', $extensions, true );
	}
	return true;
}

/** Add only the .cast extension; never enable generic JSON, text, HTML or SVG. */
function allow_cast_upload_mime( $mimes, $user = null ) {
	if ( can_upload_cast( $user ) ) {
		$mimes['cast'] = CAST_MIME;
	}
	return $mimes;
}

/** A filename must actually end in .cast, including before WordPress sanitizes it. */
function is_cast_filename( $filename ) {
	return is_string( $filename ) && 1 === preg_match( '/\.cast\z/i', $filename );
}

/** Finite, nonnegative seconds that remain finite in the player's milliseconds. */
function is_cast_time( $value ) {
	return ( is_int( $value ) || is_float( $value ) ) && $value >= 0 && is_finite( $value * 1000 );
}

/** Bound both initial and resize dimensions before they reach the terminal. */
function is_cast_dimension( $value ) {
	return is_int( $value ) && $value > 0 && $value <= CAST_MAX_DIMENSION;
}

/** Validate metadata used by asciinema-player; unknown fields remain compatible. */
function is_cast_header( $header ) {
	if ( ! is_object( $header ) || ! isset( $header->version ) || ! in_array( $header->version, array( 1, 2, 3 ), true ) ) {
		return false;
	}
	$terminal = 3 === $header->version ? ( $header->term ?? null ) : $header;
	if ( ! is_object( $terminal ) ) {
		return false;
	}
	$cols = 3 === $header->version ? ( $terminal->cols ?? null ) : ( $terminal->width ?? null );
	$rows = 3 === $header->version ? ( $terminal->rows ?? null ) : ( $terminal->height ?? null );
	if ( ! is_cast_dimension( $cols ) || ! is_cast_dimension( $rows ) ) {
		return false;
	}
	foreach ( array( 'duration', 'idle_time_limit' ) as $key ) {
		if ( property_exists( $header, $key ) && ! is_cast_time( $header->$key ) ) {
			return false;
		}
	}
	return true;
}

/** Validate a whole bounded legacy v1 document, including every stdout frame. */
function is_cast_v1( $text ) {
	$recording = json_decode( $text, false, 16 );
	if ( JSON_ERROR_NONE !== json_last_error() || ! is_cast_header( $recording ) || 1 !== $recording->version || ! isset( $recording->stdout ) || ! is_array( $recording->stdout ) || count( $recording->stdout ) > CAST_MAX_EVENTS ) {
		return false;
	}
	$time = 0;
	foreach ( $recording->stdout as $frame ) {
		if ( ! is_array( $frame ) || 2 !== count( $frame ) || ! is_cast_time( $frame[0] ) || ! is_string( $frame[1] ) ) {
			return false;
		}
		$time += $frame[0];
		if ( ! is_cast_time( $time ) ) {
			return false;
		}
	}
	return true;
}

/** Validate one JSONL event, with absolute v2 time or relative v3 intervals. */
function is_cast_event( $event, $version, &$time ) {
	if ( ! is_array( $event ) || 3 !== count( $event ) || ! is_cast_time( $event[0] ) || ! is_string( $event[1] ) || '' === $event[1] || ! is_string( $event[2] ) ) {
		return false;
	}
	if ( 2 === $version && $event[0] < $time ) {
		return false;
	}
	$time = 2 === $version ? $event[0] : $time + $event[0];
	if ( ! is_cast_time( $time ) ) {
		return false;
	}
	if ( 'r' === $event[1] ) {
		if ( 1 !== preg_match( '/^([1-9][0-9]{0,3})x([1-9][0-9]{0,3})$/D', $event[2], $matches ) || ! is_cast_dimension( (int) $matches[1] ) || ! is_cast_dimension( (int) $matches[2] ) ) {
			return false;
		}
	}
	// Unknown event codes are intentionally accepted, as required by the format.
	return true;
}

/**
 * Inspect the entire file, not just a plausible header or a MIME guess.
 *
 * v2/v3 are read line by line. v1 needs a bounded complete JSON decode. Limits
 * bound bytes, per-line memory, nesting and event count, including malformed input.
 * Formats: https://docs.asciinema.org/manual/asciicast/ (v1, v2 and v3).
 *
 * @param string $path Local temporary upload path; stream wrappers are forbidden.
 * @return bool
 */
function is_valid_cast_file( $path ) {
	if ( ! is_string( $path ) || '' === $path || false !== strpos( $path, '://' ) || ! is_file( $path ) || ! is_readable( $path ) ) {
		return false;
	}
	// Read-only local upload validation needs bounded streaming; WP_Filesystem reads whole files.
	$handle = fopen( $path, 'rb' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- Local temporary upload only; wrappers rejected above.
	if ( false === $handle ) {
		return false;
	}
	try {
		$stat = fstat( $handle );
		if ( false === $stat || $stat['size'] < 1 || $stat['size'] > CAST_MAX_BYTES ) {
			return false;
		}
		$line = fgets( $handle, CAST_MAX_LINE_BYTES + 2 );
		if ( false === $line || strlen( $line ) > CAST_MAX_LINE_BYTES ) {
			return false;
		}
		$header = json_decode( $line, false, 16 );
		// Player 3.17 interprets a complete first-line object as JSONL and rejects
		// version 1 there. Keep uploads playable: legacy v1 must be pretty-printed.
		if ( is_object( $header ) && isset( $header->version ) && 1 === $header->version ) {
			return false;
		}
		if ( ! is_cast_header( $header ) ) {
			if ( $stat['size'] > CAST_MAX_V1_BYTES || 0 !== fseek( $handle, 0 ) ) {
				return false;
			}
			$text = stream_get_contents( $handle, CAST_MAX_V1_BYTES + 1 );
			return false !== $text && strlen( $text ) <= CAST_MAX_V1_BYTES && feof( $handle ) && is_cast_v1( $text );
		}
		$bytes = strlen( $line );
		$count = 0;
		$time = 0;
		while ( false !== ( $line = fgets( $handle, CAST_MAX_LINE_BYTES + 2 ) ) ) {
			$bytes += strlen( $line );
			if ( $bytes > CAST_MAX_BYTES || strlen( $line ) > CAST_MAX_LINE_BYTES || ++$count > CAST_MAX_EVENTS ) {
				return false;
			}
			if ( 3 === $header->version && '#' === $line[0] ) {
				continue;
			}
			// The bundled player's JSONL parser only consumes lines starting with
			// '['; reject indented events rather than silently losing their output.
			if ( '[' !== $line[0] ) {
				return false;
			}
			// Empty extra lines and non-event trailing content are not valid JSONL.
			$event = json_decode( $line, false, 16 );
			if ( JSON_ERROR_NONE !== json_last_error() || ! is_cast_event( $event, $header->version, $time ) ) {
				return false;
			}
		}
		return feof( $handle );
	} finally {
		fclose( $handle ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- Always close the bounded read-only upload stream.
	}
}

/** Reject invalid .cast uploads even for users with unfiltered_upload permission. */
function validate_cast_upload( $file ) {
	if ( ! isset( $file['name'] ) || ! is_cast_filename( $file['name'] ) || ! empty( $file['error'] ) ) {
		return $file;
	}
	$allowed = get_allowed_mime_types();
	if ( ! can_upload_cast() || ! isset( $allowed['cast'] ) || CAST_MIME !== $allowed['cast'] ) {
		$file['error'] = __( 'You are not allowed to upload Asciicast files.', 'wp-asciiplayer' );
	} elseif ( ! is_valid_cast_file( $file['tmp_name'] ?? null ) ) {
		$file['error'] = __( 'Upload a valid Asciicast v2/v3 JSONL or pretty-printed v1 .cast recording (up to 32 MiB; v1 up to 2 MiB, 100,000 events, 256 KiB per JSONL line, and 1,000 columns or rows).', 'wp-asciiplayer' );
	}
	return $file;
}

/** Override generic fileinfo MIME guesses only for an allowed, validated .cast. */
function check_cast_filetype( $data, $file, $filename, $mimes = null, $real_mime = false ) {
	if ( ! is_cast_filename( $filename ) ) {
		return $data;
	}
	$global_allowed = get_allowed_mime_types();
	$allowed = null === $mimes ? $global_allowed : $mimes;
	// wp_check_filetype() treats an empty map as its default map. Do not let an
	// explicitly empty allow-list silently re-enable this extension.
	$checked = is_array( $allowed ) && ! empty( $allowed ) ? wp_check_filetype( $filename, $allowed ) : array( 'ext' => false, 'type' => false );
	if ( can_upload_cast() && isset( $global_allowed['cast'] ) && CAST_MIME === $global_allowed['cast'] && 'cast' === strtolower( (string) $checked['ext'] ) && CAST_MIME === $checked['type'] && is_valid_cast_file( $file ) ) {
		$data['ext'] = 'cast';
		$data['type'] = CAST_MIME;
		$data['proper_filename'] = false;
	} else {
		$data['ext'] = false;
		$data['type'] = false;
		$data['proper_filename'] = false;
	}
	return $data;
}
