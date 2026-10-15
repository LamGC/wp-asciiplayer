import { __ } from '@wordpress/i18n';

/** Never expose remote content or raw exception messages in a recording notice. */
export function recordingErrorMessage( error, { frontend = false } = {} ) {
	switch ( error?.code ) {
		case 'aborted': return '';
		case 'bytes': return __( 'This recording exceeds the file size limit.', 'wp-asciiplayer' );
		case 'line': return __( 'This recording contains a line that exceeds the size limit.', 'wp-asciiplayer' );
		case 'events': return __( 'This recording contains too many events.', 'wp-asciiplayer' );
		case 'markers': return __( 'This recording contains too many markers.', 'wp-asciiplayer' );
		case 'dimensions': return __( 'This recording requests terminal dimensions that exceed the supported limits.', 'wp-asciiplayer' );
		case 'cells': return __( 'This recording requests too many terminal cells.', 'wp-asciiplayer' );
		case 'complexity': return __( 'This recording is too complex to load safely.', 'wp-asciiplayer' );
		case 'timeout': return __( 'The recording is taking too long to load. Check your connection and try again.', 'wp-asciiplayer' );
		case 'time': return __( 'This recording contains an invalid or unsupported timestamp.', 'wp-asciiplayer' );
		// Invalid data, network/CORS failures, missing stream support, and policy
		// configuration errors retain the existing localized fallback guidance.
		default: return frontend
			? __( 'Unable to load this terminal recording. The file may be unavailable, invalid, or blocked by the source server’s CORS policy.', 'wp-asciiplayer' )
			: __( 'Unable to load the recording. Check the URL, file format, and the source server’s CORS permissions.', 'wp-asciiplayer' );
	}
}
