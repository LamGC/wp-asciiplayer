import { Button, Notice, Spinner } from '@wordpress/components';
import { useRefEffect } from '@wordpress/compose';
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { normalizePlayerOptions, previewHeight } from './options.js';
import { playerAssets, playerForDocument } from './player-bridge.js';

export default function Preview( { source, attributes, attempt, onRetry } ) {
	const [ status, setStatus ] = useState( 'loading' );
	const [ problem, setProblem ] = useState( '' );
	const optionsJSON = JSON.stringify( normalizePlayerOptions( attributes, { preview: true } ) );
	const playerRef = useRefEffect( ( container ) => {
		let disposed = false;
		let player;
		let readinessTimer;
		let deadline;
		const canvasWindow = container.ownerDocument.defaultView;
		const request = new canvasWindow.AbortController();
		setStatus( 'loading' );
		setProblem( '' );
		const fail = ( message ) => {
			if ( disposed ) return;
			canvasWindow.clearInterval( readinessTimer );
			canvasWindow.clearTimeout( deadline );
			setProblem( message );
			setStatus( 'error' );
		};
		const ready = () => {
			if ( disposed ) return;
			canvasWindow.clearInterval( readinessTimer );
			canvasWindow.clearTimeout( deadline );
			setStatus( 'ready' );
		};
		playerForDocument( container.ownerDocument, playerAssets() ).then( ( api ) => {
			if ( disposed ) return;
			player = api.create( { url: source, fetchOpts: { signal: request.signal } }, container, JSON.parse( optionsJSON ) );
			player.addEventListener( 'error', () => fail( __( 'Unable to load the recording. Check the URL, file format, and the source server’s CORS permissions.', 'wp-asciiplayer' ) ) );
			player.addEventListener( 'playing', ready );
			// getDuration is public API; a mounted wrapper alone does not mean the
			// recording loaded successfully. Works across supported player versions.
			const checkReady = () => {
				const duration = player.getDuration();
				if ( typeof duration === 'number' && Number.isFinite( duration ) ) ready();
			};
			readinessTimer = canvasWindow.setInterval( checkReady, 150 );
			deadline = canvasWindow.setTimeout( () => fail( __( 'The recording is taking too long to load. Check your connection and try again.', 'wp-asciiplayer' ) ), 30000 );
			checkReady();
		} ).catch( () => fail( __( 'The local player could not start. Try again, or check that the plugin’s built assets are installed.', 'wp-asciiplayer' ) ) );
		return () => {
			disposed = true;
			request.abort();
			canvasWindow.clearInterval( readinessTimer );
			canvasWindow.clearTimeout( deadline );
			if ( player ) player.dispose();
			container.replaceChildren();
		};
	}, [ source, optionsJSON, attempt ] );

	return (
		<div className="asciiplayer-editor__preview" data-preview-status={ status }>
			{ status === 'loading' && <div className="asciiplayer-editor__status" role="status"><Spinner />{ __( 'Loading recording…', 'wp-asciiplayer' ) }</div> }
			{ status === 'error' && <Notice status="error" isDismissible={ false }><p>{ problem }</p><Button variant="secondary" onClick={ onRetry }>{ __( 'Retry preview', 'wp-asciiplayer' ) }</Button></Notice> }
			<div className="asciiplayer-editor__player" style={ { height: previewHeight( attributes ) } } ref={ playerRef } aria-label={ __( 'Interactive terminal recording preview', 'wp-asciiplayer' ) } />
			{ [ 'height', 'both' ].includes( attributes.fit ) && <p className="asciiplayer-editor__hint">{ __( 'Height-based previews use the shortcode’s fixed height when available, or a 320px editor frame. Published height still comes from your container style.', 'wp-asciiplayer' ) }</p> }
			<p className="asciiplayer-editor__hint">{ __( 'Use the player controls to play, pause, and seek. Autoplay is disabled only in the editor.', 'wp-asciiplayer' ) }</p>
		</div>
	);
}
