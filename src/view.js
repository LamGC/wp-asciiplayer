import { normalizePlayerOptions, normalizeSource } from './options.js';
import { loadRecording, validateInitialDimensions } from './recording-loader.js';
import { recordingErrorMessage } from './recording-errors.js';

const instances = new WeakMap();
const documents = new WeakMap();

function showError( container, error ) {
	const message = recordingErrorMessage( error, { frontend: true } );
	if ( ! message ) return;
	container.dataset.apStatus = 'error';
	if ( container.querySelector( '.asciiplayer-error' ) ) return;
	const notice = container.ownerDocument.createElement( 'p' );
	notice.className = 'asciiplayer-error';
	notice.setAttribute( 'role', 'status' );
	notice.textContent = message;
	container.appendChild( notice );
}

/** One observer per document, visiting only owned players on removals. */
function watchRemoval( container, dispose ) {
	const document = container.ownerDocument;
	let state = documents.get( document );
	if ( ! state ) {
		const entries = new Map();
		const observer = new document.defaultView.MutationObserver( ( records ) => {
			if ( ! records.some( ( record ) => record.removedNodes.length ) ) return;
			for ( const [ node, cleanup ] of entries ) if ( ! node.isConnected ) cleanup();
		} );
		observer.observe( document.documentElement, { childList: true, subtree: true } );
		state = { entries, observer };
		documents.set( document, state );
	}
	state.entries.set( container, dispose );
	return () => {
		state.entries.delete( container );
		if ( ! state.entries.size ) {
			state.observer.disconnect();
			documents.delete( document );
		}
	};
}

/** One explicit instance per front-end container; never scan an editor canvas. */
export function mountPlayers( root = document ) {
	const ownerDocument = root.ownerDocument || root;
	if ( ownerDocument.body?.classList.contains( 'wp-admin' ) || ownerDocument.querySelector( '.editor-styles-wrapper, .block-editor-block-list__layout' ) ) return;
	const canvasWindow = ownerDocument.defaultView;
	const api = canvasWindow?.AsciinemaPlayer;
	if ( typeof api?.create !== 'function' ) return;
	root.querySelectorAll( '.asciiplayer-container' ).forEach( ( container ) => {
		if ( instances.has( container ) ) return;
		const source = normalizeSource( container.dataset.apSrc );
		if ( ! source ) return showError( container );
		let options;
		try {
			// Accept both current plain JSON and the legacy URL-encoded options.
			const serialized = container.dataset.apOptions;
			options = serialized ? JSON.parse( serialized ) : JSON.parse( decodeURIComponent( container.dataset.apOpts || '{}' ) );
			if ( ! options || Array.isArray( options ) || typeof options !== 'object' ) throw new Error( 'Invalid player options.' );
			options = normalizePlayerOptions( options );
		} catch {
			showError( container );
			return;
		}
		const request = new canvasWindow.AbortController();
		let disposed = false;
		let failed = false;
		let player;
		let timer;
		let unwatch;
		const dispose = () => {
			if ( disposed ) return;
			disposed = true;
			request.abort();
			canvasWindow.clearInterval( timer );
			unwatch?.();
			player?.dispose();
			instances.delete( container );
		};
		const fail = ( error ) => {
			if ( disposed || failed || ! recordingErrorMessage( error ) ) return;
			failed = true;
			request.abort();
			canvasWindow.clearInterval( timer );
			showError( container, error );
		};
		const ready = () => {
			if ( ! disposed && ! failed ) {
				container.dataset.apStatus = 'ready';
				canvasWindow.clearInterval( timer );
			}
		};
		try {
			validateInitialDimensions( options );
			container.dataset.apStatus = 'loading';
			// The player calls data lazily: preload=false causes no eager request.
			player = api.create( { data: () => loadRecording( source, {
				fetchImpl: canvasWindow.fetch.bind( canvasWindow ), signal: request.signal, options,
			} ).catch( ( error ) => { fail( error ); throw error; } ) }, container, options );
			instances.set( container, { player, dispose } );
			unwatch = watchRemoval( container, dispose );
			player.addEventListener( 'error', () => fail() );
			player.addEventListener( 'playing', ready );
			if ( options.preload || options.autoPlay || options.poster?.startsWith( 'npt:' ) ) {
				let ticks = 0;
				timer = canvasWindow.setInterval( () => {
					if ( ! container.isConnected ) return dispose();
					const duration = player.getDuration();
					if ( typeof duration === 'number' && Number.isFinite( duration ) ) ready();
					if ( ++ticks > 200 ) canvasWindow.clearInterval( timer );
				}, 150 );
			} else {
				container.dataset.apStatus = 'idle';
			}
		} catch ( error ) {
			fail( error );
			dispose();
		}
	} );
}

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', () => mountPlayers(), { once: true } );
} else {
	mountPlayers();
}
