/** Only inspect a small prefix; metadata must never buffer a second full cast. */
export const MAX_HEADER_BYTES = 64 * 1024;

/** Original dimensions, without the player's fallback or editor overrides. */
export function recordingSizeFromHeader( header ) {
	if ( ! header || typeof header !== 'object' || Array.isArray( header ) ) return null;
	let cols;
	let rows;
	if ( header.version === 1 || header.version === 2 ) {
		cols = header.width;
		rows = header.height;
	} else if ( header.version === 3 ) {
		cols = header.term?.cols;
		rows = header.term?.rows;
	} else {
		return null;
	}
	// These are display-only hints, so do not apply the editor override limit.
	const valid = ( value ) => Number.isSafeInteger( value ) && value > 0;
	return valid( cols ) && valid( rows ) ? { cols, rows } : null;
}

/**
 * Read complete top-level JSON members, never regex-match nested fields/output.
 * v1 is one large JSON object, often pretty-printed, so its dimensions can be
 * returned before stdout. v2/v3 require their complete first header object.
 */
function createHeaderReader() {
	let text = '';
	let cursor = 0;
	let memberStart;
	let quoted = false;
	let escaped = false;
	let members = 0;
	const stack = [];
	const header = Object.create( null );
	const unknown = { done: true, size: null };

	return ( chunk ) => {
		text += chunk;
		for ( ; cursor < text.length; cursor++ ) {
			const character = text[ cursor ];
			if ( memberStart === undefined ) {
				if ( /\s/.test( character ) ) continue;
				if ( character !== '{' ) return unknown;
				stack.push( '{' );
				memberStart = cursor + 1;
				continue;
			}
			if ( quoted ) {
				if ( escaped ) escaped = false;
				else if ( character === '\\' ) escaped = true;
				else if ( character === '"' ) quoted = false;
				continue;
			}
			if ( character === '"' ) {
				quoted = true;
				continue;
			}
			if ( character === '{' || character === '[' ) {
				stack.push( character );
				continue;
			}
			const closing = character === '}' || character === ']';
			if ( closing && stack.at( -1 ) !== ( character === '}' ? '{' : '[' ) ) return unknown;
			if ( stack.length === 1 && ( character === ',' || closing ) ) {
				const member = text.slice( memberStart, cursor ).trim();
				if ( ! member && ( members || ! closing ) ) return unknown;
				try {
					Object.assign( header, JSON.parse( `{${ member }}` ) );
				} catch {
					return unknown;
				}
				members++;
				const size = recordingSizeFromHeader( header );
				if ( closing || ( header.version === 1 && size ) ) return { done: true, size };
				memberStart = cursor + 1;
			}
			if ( closing ) stack.pop();
		}
		return { done: false, size: null };
	};
}

/**
 * Inspect a clone of the player's existing response. The original response is
 * untouched, and callers can pass it to the player while this branch is read.
 * Missing streams, invalid/oversized headers and read failures stay unknown.
 */
export async function readRecordingSize( response ) {
	let reader;
	try {
		if ( ! response.ok || ! response.body?.getReader ) return null;
		reader = response.clone().body.getReader();
		const decode = new TextDecoder( 'utf-8', { fatal: true } );
		const readHeader = createHeaderReader();
		let bytes = 0;
		while ( bytes < MAX_HEADER_BYTES ) {
			const { value, done } = await reader.read();
			if ( done ) return readHeader( decode.decode() ).size;
			const prefix = value.subarray( 0, MAX_HEADER_BYTES - bytes );
			bytes += prefix.byteLength;
			const result = readHeader( decode.decode( prefix, { stream: true } ) );
			if ( result.done ) return result.size;
		}
		return null;
	} catch {
		return null;
	} finally {
		// A cloned Response tees the stream. Awaiting cancellation can wait for
		// the player's other branch to finish, delaying metadata or deadlocking.
		if ( reader ) reader.cancel().catch( () => {} );
	}
}
