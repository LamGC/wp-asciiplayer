import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import { Button, Notice, PanelBody, Placeholder, RangeControl, SelectControl, TextControl, ToggleControl } from '@wordpress/components';
import { useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { finiteNumber, normalizeSource, normalizeWidth } from './options.js';
import Preview from './preview.js';

export default function Edit( { attributes, setAttributes } ) {
	const { source, theme, speed, loop, controls, fit, startAt, idleTimeLimit, autoPlay, preload, width } = attributes;
	const [ draftSource, setDraftSource ] = useState( source );
	const [ approvedSource, setApprovedSource ] = useState( '' );
	const [ urlError, setUrlError ] = useState( false );
	const [ attempt, setAttempt ] = useState( 0 );
	useEffect( () => setDraftSource( source ), [ source ] );
	const blockProps = useBlockProps( { className: 'asciiplayer-editor' } );
	const applySource = ( event ) => {
		event.preventDefault();
		const next = normalizeSource( draftSource );
		setUrlError( ! next );
		if ( ! next ) return;
		setAttributes( { source: next } );
		setDraftSource( next );
		setApprovedSource( next );
		setAttempt( ( current ) => current + 1 );
	};
	const themes = [
		{ label: __( 'Asciinema', 'wp-asciiplayer' ), value: 'asciinema' },
		{ label: __( 'Recording theme (automatic)', 'wp-asciiplayer' ), value: 'auto/asciinema' },
		{ label: 'Dracula', value: 'dracula' }, { label: 'Monokai', value: 'monokai' },
		{ label: 'Nord', value: 'nord' }, { label: 'Solarized Dark', value: 'solarized-dark' },
		{ label: 'Solarized Light', value: 'solarized-light' }, { label: 'Tango', value: 'tango' },
	];
	if ( ! themes.some( ( option ) => option.value === theme ) ) themes.push( { label: theme, value: theme } );
	const widthOptions = [ '100%', '80%', '60%', '50%' ].map( ( value ) => ( { label: value, value } ) );
	if ( ! widthOptions.some( ( option ) => option.value === width ) ) widthOptions.push( { label: width, value: width } );
	const fitOptions = [
		{ label: __( 'Width', 'wp-asciiplayer' ), value: 'width' },
		{ label: __( 'Original size', 'wp-asciiplayer' ), value: 'none' },
	];
	if ( fit === 'height' || fit === 'both' ) fitOptions.push( { label: fit === 'height' ? __( 'Height (legacy)', 'wp-asciiplayer' ) : __( 'Width and height (legacy)', 'wp-asciiplayer' ), value: fit } );
	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Playback', 'wp-asciiplayer' ) }>
					<RangeControl label={ __( 'Playback speed', 'wp-asciiplayer' ) } value={ speed } min={ 0.25 } max={ Math.max( 8, speed ) } step={ 0.25 } onChange={ ( value ) => setAttributes( { speed: finiteNumber( value, 1, 0.01, 100 ) } ) } />
					<ToggleControl label={ __( 'Loop playback', 'wp-asciiplayer' ) } checked={ loop } onChange={ ( value ) => setAttributes( { loop: value } ) } />
					<ToggleControl label={ __( 'Autoplay on published page', 'wp-asciiplayer' ) } help={ __( 'The editor preview always waits for you to press play.', 'wp-asciiplayer' ) } checked={ autoPlay } onChange={ ( value ) => setAttributes( { autoPlay: value } ) } />
					<ToggleControl label={ __( 'Preload on published page', 'wp-asciiplayer' ) } help={ __( 'Loads the recording before the visitor presses play. The editor always preloads after you apply the URL.', 'wp-asciiplayer' ) } checked={ preload } onChange={ ( value ) => setAttributes( { preload: value } ) } />
					<TextControl label={ __( 'Start at (seconds)', 'wp-asciiplayer' ) } type="number" min="0" step="0.1" value={ startAt } onChange={ ( value ) => setAttributes( { startAt: finiteNumber( value, 0 ) } ) } />
					<TextControl label={ __( 'Idle time limit (seconds)', 'wp-asciiplayer' ) } help={ __( 'Shorten long pauses. Use 0 to keep the recording’s default.', 'wp-asciiplayer' ) } type="number" min="0" step="0.1" value={ idleTimeLimit } onChange={ ( value ) => setAttributes( { idleTimeLimit: finiteNumber( value, 0 ) } ) } />
				</PanelBody>
				<PanelBody title={ __( 'Appearance', 'wp-asciiplayer' ) }>
					<SelectControl label={ __( 'Theme', 'wp-asciiplayer' ) } value={ theme } options={ themes } onChange={ ( value ) => setAttributes( { theme: value } ) } />
					<SelectControl label={ __( 'Player controls', 'wp-asciiplayer' ) } value={ controls } options={ [
						{ label: __( 'Show on interaction', 'wp-asciiplayer' ), value: 'auto' },
						{ label: __( 'Always show', 'wp-asciiplayer' ), value: 'always' },
						{ label: __( 'Hide', 'wp-asciiplayer' ), value: 'never' },
					] } onChange={ ( value ) => setAttributes( { controls: value } ) } />
					<SelectControl label={ __( 'Fit', 'wp-asciiplayer' ) } value={ fit } options={ fitOptions } help={ [ 'height', 'both' ].includes( fit ) ? __( 'Height-based fitting requires a fixed container height in your site CSS.', 'wp-asciiplayer' ) : undefined } onChange={ ( value ) => setAttributes( { fit: value } ) } />
					<SelectControl label={ __( 'Player width', 'wp-asciiplayer' ) } value={ width } options={ widthOptions } onChange={ ( value ) => setAttributes( { width: value } ) } />
					{ attributes.legacyStyle && <p>{ __( 'The custom container style from your shortcode is preserved on the published page.', 'wp-asciiplayer' ) }</p> }
				</PanelBody>
			</InspectorControls>
			<div { ...blockProps }>
				<div className="asciiplayer-editor__source">
					<form onSubmit={ applySource }>
						<TextControl label={ __( 'Recording URL', 'wp-asciiplayer' ) } placeholder="https://example.com/recording.cast" value={ draftSource } onChange={ ( value ) => { setDraftSource( value ); setUrlError( false ); } } autoComplete="off" />
						<Button type="submit" variant="primary">{ __( 'Apply URL', 'wp-asciiplayer' ) }</Button>
					</form>
					<p className="asciiplayer-editor__privacy">{ __( 'Applying a URL loads the recording directly from that server, which receives your browser’s request. Published players contact the same server. Use a direct .cast URL; external servers must allow CORS.', 'wp-asciiplayer' ) }</p>
					{ urlError && <Notice status="error" isDismissible={ false }>{ __( 'Enter an HTTP(S) recording URL or a path starting with a single /.', 'wp-asciiplayer' ) }</Notice> }
				</div>
				{ approvedSource && approvedSource === source ? (
					<div style={ { width: normalizeWidth( width ), maxWidth: '100%' } }>
						<Preview source={ source } attributes={ attributes } attempt={ attempt } onRetry={ () => setAttempt( ( current ) => current + 1 ) } />
					</div>
				) : (
					<Placeholder icon="editor-code" label={ __( 'Asciicast Player', 'wp-asciiplayer' ) } instructions={ source ? __( 'Load the saved recording to play and adjust it here.', 'wp-asciiplayer' ) : __( 'Paste a terminal recording URL above, then apply it to see an interactive preview.', 'wp-asciiplayer' ) }>
						{ source && <Button variant="secondary" onClick={ () => { setApprovedSource( source ); setAttempt( ( current ) => current + 1 ); } }>{ __( 'Load preview', 'wp-asciiplayer' ) }</Button> }
					</Placeholder>
				) }
			</div>
		</>
	);
}
