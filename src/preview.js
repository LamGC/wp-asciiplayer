import { Button, Notice, Spinner } from '@wordpress/components';
import { useRefEffect } from '@wordpress/compose';
import { useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { normalizePlayerOptions, previewHeight } from './options.js';
import { playerAssets, playerForDocument } from './player-bridge.js';
import { readRecordingSize } from './recording-metadata.js';

export default function Preview( { source, attributes, attempt, onRetry, onRecordingSize } ) {
	const [ status, setStatus ] = useState( 'loading' );
	const [ problem, setProblem ] = useState( '' );
	const onRecordingSizeRef = useRef( onRecordingSize );
	onRecordingSizeRef.current = onRecordingSize;
	const optionsJSON = JSON.stringify( normalizePlayerOptions( attributes, { preview: true } ) );
	const playerRef = useRefEffect( ( container ) => {
		let disposed = false;
		let failed = false;
		let player;
		let readinessTimer;
		let deadline;
		const canvasWindow = container.ownerDocument.defaultView;
		const request = new canvasWindow.AbortController();
		const reportSize = ( size ) => {
			if ( ! disposed ) onRecordingSizeRef.current?.( source, size );
		};
		setStatus( 'loading' );
		setProblem( '' );
		reportSize( null );
		const fail = ( message ) => {
			if ( disposed || failed ) return;
			failed = true;
			request.abort();
			canvasWindow.clearInterval( readinessTimer );
			canvasWindow.clearTimeout( deadline );
			reportSize( null );
			setProblem( message );
			setStatus( 'error' );
		};
		const ready = () => {
			if ( disposed || failed ) return;
			canvasWindow.clearInterval( readinessTimer );
			canvasWindow.clearTimeout( deadline );
			setStatus( 'ready' );
		};
		playerForDocument( container.ownerDocument, playerAssets() ).then( ( api ) => {
			if ( disposed ) return;
			player = api.create( {
				data: async () => {
					// The parser checks instanceof Response in the canvas realm.
					// Reuse this one request for playback and original-size hints.
					const response = await canvasWindow.fetch( source, { signal: request.signal } );
					if ( ! response.ok ) throw new Error( `Recording request failed: ${ response.status }` );
					readRecordingSize( response ).then( ( size ) => {
						if ( ! failed ) reportSize( size );
					} );
					return response;
				},
			}, container, JSON.parse( optionsJSON ) );
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
		</div>
	);
}
