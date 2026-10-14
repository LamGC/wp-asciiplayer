import { __ } from '@wordpress/i18n';
import { normalizePlayerOptions, normalizeSource } from './options.js';

const instances = new WeakMap();

function showError( container ) {
	container.dataset.apStatus = 'error';
	if ( container.querySelector( '.asciiplayer-error' ) ) return;
	const notice = container.ownerDocument.createElement( 'p' );
	notice.className = 'asciiplayer-error';
	notice.setAttribute( 'role', 'status' );
	notice.textContent = __( 'Unable to load this terminal recording. The file may be unavailable, invalid, or blocked by the source server’s CORS policy.', 'wp-asciiplayer' );
	container.appendChild( notice );
}

/** One explicit instance per front-end container; never scan an editor canvas. */
export function mountPlayers( root = document ) {
	const ownerDocument = root.ownerDocument || root;
	if ( ownerDocument.body?.classList.contains( 'wp-admin' ) || ownerDocument.querySelector( '.editor-styles-wrapper, .block-editor-block-list__layout' ) ) return;
	const api = ownerDocument.defaultView?.AsciinemaPlayer;
	if ( typeof api?.create !== 'function' ) return;
	root.querySelectorAll( '.asciiplayer-container' ).forEach( ( container ) => {
		if ( instances.has( container ) ) return;
		const source = normalizeSource( container.dataset.apSrc );
		if ( ! source ) return showError( container );
		let options;
		try {
			// New markup uses escaped plain JSON. The legacy adapter used URL-encoded
			// JSON; accepting it also lets cached old pages use the new local player.
			const serialized = container.dataset.apOptions;
			options = serialized ? JSON.parse( serialized ) : JSON.parse( decodeURIComponent( container.dataset.apOpts || '{}' ) );
			if ( ! options || Array.isArray( options ) || typeof options !== 'object' ) throw new Error( 'Invalid player options.' );
			options = normalizePlayerOptions( options );
		} catch {
			showError( container );
			return;
		}
		try {
			container.dataset.apStatus = 'loading';
			const player = api.create( source, container, options );
			instances.set( container, player );
			player.addEventListener( 'error', () => showError( container ) );
			player.addEventListener( 'playing', () => { container.dataset.apStatus = 'ready'; } );
			// The upstream player owns loading/error/controls; readiness is confirmed
			// by its parsed duration rather than merely by a mounted DOM wrapper.
			if ( options.preload || options.autoPlay || options.poster?.startsWith( 'npt:' ) ) {
				let ticks = 0;
				const timer = ownerDocument.defaultView.setInterval( () => {
					const duration = player.getDuration();
					if ( typeof duration === 'number' && Number.isFinite( duration ) ) container.dataset.apStatus = 'ready';
					if ( ! container.isConnected || container.dataset.apStatus !== 'loading' || ++ticks > 200 ) ownerDocument.defaultView.clearInterval( timer );
				}, 150 );
			} else {
				container.dataset.apStatus = 'idle';
			}
		} catch {
			showError( container );
		}
	} );
}

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', () => mountPlayers(), { once: true } );
} else {
	mountPlayers();
}
