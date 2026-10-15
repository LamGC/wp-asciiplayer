/** Resource policy for untrusted recordings, before handing data to the player. */
export const DEFAULT_LIMITS = Object.freeze( {
	bytes: 32 * 1024 * 1024, v1Bytes: 2 * 1024 * 1024, lineBytes: 256 * 1024,
	depth: 15, containers: 100016, tokens: 400000, lineTokens: 20000,
	events: 100000, lines: 100000, markers: 1000, dimension: 1000, cells: 40000,
	// Web timers take a signed 32-bit millisecond delay (~24.85 days). This
	// horizon also keeps upstream's 16.67 ms output batches numerically distinct.
	timelineMs: 2147483647,
	totalTimeoutMs: 30000, idleTimeoutMs: 10000,
} );

export class RecordingLoadError extends Error {
	constructor( code ) {
		super( `Recording load failed: ${ code }` );
		this.name = 'RecordingLoadError';
		this.code = code;
	}
}
const fail = ( code ) => { throw new RecordingLoadError( code ); };
const boundedTime = ( value, maxMs ) => typeof value === 'number' && value >= 0 && value * 1000 <= maxMs;
const object = ( value ) => value !== null && typeof value === 'object' && ! Array.isArray( value );

/** Guard the terminal allocated by api.create before its data loader runs. */
export function validateInitialDimensions( options = {}, limits = {} ) {
	const dimension = limits.dimension ?? DEFAULT_LIMITS.dimension;
	const cells = limits.cells ?? DEFAULT_LIMITS.cells;
	if ( ! Number.isSafeInteger( dimension ) || dimension <= 0 || ! Number.isSafeInteger( cells ) || cells <= 0 ) fail( 'policy' );
	const cols = options.cols ?? 80;
	const rows = options.rows ?? 24;
	if ( ! Number.isSafeInteger( cols ) || cols < 1 || cols > dimension || ! Number.isSafeInteger( rows ) || rows < 1 || rows > dimension ) fail( 'dimensions' );
	if ( cols * rows > cells ) fail( 'cells' );
}

/** Count allocation-driving JSON tokens before JSON.parse allocates containers. */
function parseBounded( text, limits, v1 = false ) {
	let quoted = false;
	let escaped = false;
	let primitive = false;
	let depth = 0;
	let tokens = 0;
	let containers = 0;
	const tokenLimit = v1 ? limits.tokens : limits.lineTokens;
	for ( const character of text ) {
		if ( quoted ) {
			if ( escaped ) escaped = false;
			else if ( character === '\\' ) escaped = true;
			else if ( character === '"' ) quoted = false;
			continue;
		}
		if ( character === '"' ) {
			quoted = true;
			primitive = false;
			tokens++;
		} else if ( character === '[' || character === '{' ) {
			primitive = false;
			if ( ++depth > limits.depth || ++containers > limits.containers ) fail( 'complexity' );
		} else if ( character === ']' || character === '}' ) {
			primitive = false;
			if ( --depth < 0 ) fail( 'invalid' );
		} else if ( character === ',' || character === ':' || /\s/.test( character ) ) {
			primitive = false;
		} else if ( ! primitive ) {
			primitive = true;
			tokens++;
		}
		if ( tokens > tokenLimit ) fail( 'complexity' );
	}
	if ( quoted || depth !== 0 ) fail( 'invalid' );
	try { return JSON.parse( text ); } catch { fail( 'invalid' ); }
}

/** Inspect version and structural completeness without allocating a JSON tree. */
function inspectFirstLine( text ) {
	let depth = 0;
	let quoted = false;
	let escaped = false;
	let start = 0;
	let version;
	function member( end ) {
		let cursor = start;
		while ( cursor < end && /\s/.test( text[ cursor ] ) ) cursor++;
		if ( text[ cursor ] !== '"' ) return;
		const keyStart = cursor++;
		let escape = false;
		while ( cursor < end ) {
			const character = text[ cursor++ ];
			if ( escape ) escape = false;
			else if ( character === '\\' ) escape = true;
			else if ( character === '"' ) break;
		}
		// "version" has seven characters, at most six JSON bytes each.
		if ( cursor - keyStart > 44 ) return;
		let key;
		try { key = JSON.parse( text.slice( keyStart, cursor ) ); } catch { return; }
		if ( key !== 'version' ) return;
		version = undefined;
		while ( cursor < end && /\s/.test( text[ cursor ] ) ) cursor++;
		if ( text[ cursor++ ] !== ':' ) return;
		while ( cursor < end && /\s/.test( text[ cursor ] ) ) cursor++;
		while ( end > cursor && /\s/.test( text[ end - 1 ] ) ) end--;
		// Numeric conversion allocates no JSON containers; the complete parser
		// will still reject malformed numeric spellings or nonnumeric values.
		version = Number( text.slice( cursor, end ) );
	}
	for ( let index = 0; index < text.length; index++ ) {
		const character = text[ index ];
		if ( quoted ) {
			if ( escaped ) escaped = false;
			else if ( character === '\\' ) escaped = true;
			else if ( character === '"' ) quoted = false;
			continue;
		}
		if ( character === '"' ) quoted = true;
		else if ( character === '[' || character === '{' ) {
			if ( ++depth === 1 ) start = index + 1;
		} else if ( character === ']' || character === '}' ) {
			if ( depth === 1 ) member( index );
			depth--;
		} else if ( character === ',' && depth === 1 ) {
			member( index );
			start = index + 1;
		}
	}
	return { version, incomplete: depth > 0 || quoted };
}

/**
 * Fetch once, count actual decoded-body bytes, and validate everything before
 * returning an upstream-compatible v1 object or v2/v3 [header, ...events] array.
 * limits are intended for policy configuration/tests, never recording metadata.
 */
export async function loadRecording( source, { fetchImpl = globalThis.fetch, signal, onMetadata, options = {}, limits = {} } = {} ) {
	const policy = { ...DEFAULT_LIMITS };
	for ( const key of Object.keys( policy ) ) {
		if ( Object.hasOwn( limits, key ) ) {
			if ( ! Number.isSafeInteger( limits[ key ] ) || limits[ key ] <= 0 ) fail( 'policy' );
			policy[ key ] = limits[ key ];
		}
	}
	// Policy overrides may lower this safety ceiling, but cannot expand the
	// platform timer range. Callers supply already-normalized player options.
	if ( policy.timelineMs > DEFAULT_LIMITS.timelineMs ) fail( 'policy' );
	const speed = options.speed ?? 1;
	if ( typeof speed !== 'number' || ! Number.isFinite( speed ) || speed < 0.01 || speed > 100 ) fail( 'time' );
	for ( const key of [ 'startAt', 'idleTimeLimit' ] ) {
		if ( options[ key ] !== undefined && ! boundedTime( options[ key ], policy.timelineMs ) ) fail( 'time' );
	}
	if ( typeof options.poster === 'string' && options.poster.startsWith( 'npt:' ) ) {
		// Match upstream parseNpt's order of arithmetic for normalized timecodes.
		const posterTime = options.poster.slice( 4 ).split( ':' ).reverse().map( parseFloat ).reduce( ( sum, part, index ) => sum + part * 60 ** index, 0 );
		if ( ! boundedTime( posterTime, policy.timelineMs ) ) fail( 'time' );
	}
	function checkTimeline( milliseconds ) {
		// Core passes (target - elapsed) / speed directly to setTimeout. Bound
		// the whole horizon conservatively: adjacent gaps alone are insufficient
		// because output batching can consume future events ahead of wall time.
		if ( ! Number.isFinite( milliseconds ) || milliseconds > policy.timelineMs || milliseconds / speed > DEFAULT_LIMITS.timelineMs ) fail( 'time' );
	}
	const controller = new AbortController();
	let reader;
	let totalTimer;
	let rejectStopped;
	let stoppedError;
	const deadline = Date.now() + policy.totalTimeoutMs;
	const stopped = new Promise( ( _, reject ) => { rejectStopped = reject; } );
	// A synchronous validation failure can precede the first Promise.race.
	stopped.catch( () => {} );
	const stop = ( code ) => {
		if ( stoppedError ) return;
		stoppedError = new RecordingLoadError( code );
		rejectStopped( stoppedError );
		controller.abort();
	};
	const abort = () => stop( 'aborted' );
	async function waitFor( operation ) {
		// Also enforce elapsed time when synthetic/cached streams resolve reads in
		// microtasks without giving browser timer callbacks a turn.
		if ( Date.now() >= deadline ) stop( 'timeout' );
		if ( stoppedError ) {
			Promise.resolve( operation ).catch( () => {} );
			throw stoppedError;
		}
		let idleTimer;
		try {
			idleTimer = setTimeout( () => stop( 'timeout' ), policy.idleTimeoutMs );
			return await Promise.race( [ operation, stopped ] );
		} finally { clearTimeout( idleTimer ); }
	}
	const dimension = ( value, zero = false ) => Number.isSafeInteger( value ) && value >= ( zero ? 0 : 1 ) && value <= policy.dimension;
	function checkSize( cols, rows, zero = false ) {
		if ( ! dimension( cols, zero ) || ! dimension( rows, zero ) ) fail( 'dimensions' );
		// Upstream applies each override independently, including every resize.
		const effectiveCols = options.cols ?? ( cols || 80 );
		const effectiveRows = options.rows ?? ( rows || 24 );
		if ( ! dimension( effectiveCols ) || ! dimension( effectiveRows ) ) fail( 'dimensions' );
		if ( ( cols || 80 ) * ( rows || 24 ) > policy.cells || effectiveCols * effectiveRows > policy.cells ) fail( 'cells' );
	}
	let bytes = 0;
	let mode = 'first';
	let header;
	let timeMs = 0;
	let lines = 0;
	let markerCount = Array.isArray( options.markers ) ? options.markers.length : 0;
	const events = [];
	const v1Parts = [];
	let lineParts = [];
	let lineBytes = 0;
	const decoder = new TextDecoder( 'utf-8', { fatal: true, ignoreBOM: true } );
	function checkHeader( value ) {
		if ( ! object( value ) || ! [ 1, 2, 3 ].includes( value.version ) ) fail( 'invalid' );
		if ( value.version === 3 ) {
			if ( ! object( value.term ) ) fail( 'dimensions' );
			checkSize( value.term.cols, value.term.rows, true );
		} else checkSize( value.width, value.height, true );
		for ( const key of [ 'duration', 'idle_time_limit' ] ) {
			if ( Object.hasOwn( value, key ) && ! boundedTime( value[ key ], policy.timelineMs ) ) fail( 'time' );
		}
	}
	function acceptLine( text, size, newline ) {
		if ( mode === 'first' ) {
			// Response.text strips only the document's initial UTF-8 BOM. Keep
			// later BOMs intact so resetting at LF cannot turn ignored lines into events.
			if ( text.charCodeAt( 0 ) === 0xfeff ) text = text.slice( 1 );
			// Pretty-printed v1 is the only supported multiline JSON document.
			// A syntax-incomplete first line is collected under the smaller v1 cap.
			const first = inspectFirstLine( text );
			// A v1 document may put version after a long stdout/title member.
			// Incomplete first lines therefore use the whole-document v1 budget.
			if ( first.version === 1 || first.incomplete ) {
				mode = 'v1';
				v1Parts.push( text, newline ? '\n' : '' );
				return;
			}
			if ( size + Number( newline ) > policy.lineBytes ) fail( 'line' );
			try { header = parseBounded( text, policy ); } catch ( error ) {
				if ( error.code !== 'invalid' ) throw error;
				mode = 'v1';
				v1Parts.push( text, newline ? '\n' : '' );
				return;
			}
			if ( header?.version === 1 ) {
				mode = 'v1';
				v1Parts.push( text, newline ? '\n' : '' );
				return;
			}
			if ( size + Number( newline ) > policy.lineBytes ) fail( 'line' );
			checkHeader( header );
			mode = 'jsonl';
			return;
		}
		if ( size + Number( newline ) > policy.lineBytes ) fail( 'line' );
		// Match 3.17's JSONL filter: blank, comment, and other non-event lines
		// (including indented arrays) are ignored, but still byte/line bounded.
		if ( ++lines > policy.lines ) fail( 'events' );
		if ( text[ 0 ] !== '[' ) return;
		if ( events.length >= policy.events ) fail( 'events' );
		const event = parseBounded( text, policy );
		if ( ! Array.isArray( event ) || event.length !== 3 || typeof event[ 1 ] !== 'string' || ! event[ 1 ] || typeof event[ 2 ] !== 'string' ) fail( 'invalid' );
		if ( ! boundedTime( event[ 0 ], policy.timelineMs ) ) fail( 'time' );
		const eventMs = event[ 0 ] * 1000;
		if ( header.version === 2 && events.length && event[ 0 ] < events[ events.length - 1 ][ 0 ] ) fail( 'time' );
		// v1/v3 upstream converts each interval before adding, which can round
		// differently from summing seconds and multiplying the result by 1000.
		timeMs = header.version === 3 ? timeMs + eventMs : eventMs;
		checkTimeline( timeMs );
		if ( event[ 1 ] === 'r' ) {
			const match = /^([1-9][0-9]{0,3})x([1-9][0-9]{0,3})$/.exec( event[ 2 ] );
			if ( ! match ) fail( 'dimensions' );
			checkSize( Number( match[ 1 ] ), Number( match[ 2 ] ) );
		}
		if ( event[ 1 ] === 'm' && ++markerCount > policy.markers ) fail( 'markers' );
		events.push( event );
	}
	try {
		if ( markerCount > policy.markers ) fail( 'markers' );
		if ( signal?.aborted ) fail( 'aborted' );
		signal?.addEventListener( 'abort', abort, { once: true } );
		totalTimer = setTimeout( () => stop( 'timeout' ), policy.totalTimeoutMs );
		const response = await waitFor( Promise.resolve().then( () => fetchImpl( source, { signal: controller.signal, credentials: 'same-origin' } ) ) );
		if ( ! response.ok ) fail( 'network' );
		if ( ! response.body?.getReader ) fail( 'stream' );
		reader = response.body.getReader();
		while ( true ) {
			const { value, done } = await waitFor( reader.read() );
			if ( done ) break;
			bytes += value.byteLength;
			if ( bytes > policy.bytes || ( mode === 'v1' && bytes > policy.v1Bytes ) ) fail( 'bytes' );
			if ( mode === 'v1' ) {
				v1Parts.push( decoder.decode( value, { stream: true } ) );
				continue;
			}
			let start = 0;
			for ( let index = 0; index <= value.length; index++ ) {
				if ( index !== value.length && value[ index ] !== 10 ) continue;
				const part = value.subarray( start, index );
				lineBytes += part.byteLength;
				if ( lineBytes > ( mode === 'first' ? policy.v1Bytes : policy.lineBytes ) ) fail( 'line' );
				if ( part.byteLength ) lineParts.push( decoder.decode( part, { stream: true } ) );
				if ( index < value.length ) {
					lineParts.push( decoder.decode() );
					acceptLine( lineParts.join( '' ), lineBytes, true );
					lineParts = [];
					lineBytes = 0;
					start = index + 1;
					if ( mode === 'v1' ) {
						if ( bytes > policy.v1Bytes ) fail( 'bytes' );
						v1Parts.push( decoder.decode( value.subarray( start ), { stream: true } ) );
						break;
					}
				}
			}
		}
		const tail = decoder.decode();
		if ( mode === 'v1' ) v1Parts.push( tail );
		else {
			lineParts.push( tail );
			if ( lineBytes || mode === 'first' ) acceptLine( lineParts.join( '' ), lineBytes, false );
		}
		let result;
		if ( mode === 'v1' ) {
			if ( bytes > policy.v1Bytes ) fail( 'bytes' );
			header = parseBounded( v1Parts.join( '' ), policy, true );
			checkHeader( header );
			if ( header.version !== 1 || ! Array.isArray( header.stdout ) ) fail( 'invalid' );
			if ( header.stdout.length > policy.events ) fail( 'events' );
			for ( const event of header.stdout ) {
				if ( ! Array.isArray( event ) || event.length !== 2 || typeof event[ 1 ] !== 'string' ) fail( 'invalid' );
				if ( ! boundedTime( event[ 0 ], policy.timelineMs ) ) fail( 'time' );
				timeMs += event[ 0 ] * 1000;
				checkTimeline( timeMs );
			}
			result = header;
		} else result = [ header, ...events ];
		const cols = header.version === 3 ? header.term.cols : header.width;
		const rows = header.version === 3 ? header.term.rows : header.height;
		if ( Date.now() >= deadline ) stop( 'timeout' );
		if ( stoppedError ) throw stoppedError;
		onMetadata?.( cols > 0 && rows > 0 ? { cols, rows } : null );
		return result;
	} catch ( error ) {
		controller.abort();
		// Cancellation can itself stall (especially custom/teed streams). Never
		// await it; the public promise must settle promptly on abort/timeout.
		try { Promise.resolve( reader?.cancel() ).catch( () => {} ); } catch { /* Already closed. */ }
		if ( stoppedError ) throw stoppedError;
		if ( error instanceof RecordingLoadError ) throw error;
		fail( error instanceof TypeError && reader ? 'invalid' : 'network' );
	} finally {
		clearTimeout( totalTimer );
		signal?.removeEventListener( 'abort', abort );
		try { reader?.releaseLock(); } catch { /* A rejected read may still be pending. */ }
	}
}
