import { BlockAlignmentToolbar, BlockControls, InspectorControls, MediaUpload, MediaUploadCheck, RichText, useBlockProps } from '@wordpress/block-editor';
import { Button, Dropdown, Notice, PanelBody, Placeholder, RangeControl, SelectControl, TextControl, ToggleControl, ToolbarButton, ToolbarGroup } from '@wordpress/components';
import { useCallback, useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { finiteNumber, normalizeDisplayAlign, normalizeSource, normalizeWidth, terminalDimension } from './options.js';
import Preview from './preview.js';

/** One shared set of dimension controls in the block toolbar and settings sidebar. */
function TerminalSizeControls( { attributes, setAttributes, recordingSize } ) {
	return <>
		<div className="asciiplayer-editor__dimension-fields">
			<TextControl label={ __( 'Columns', 'wp-asciiplayer' ) } type="number" min="1" max="1000" step="1" value={ attributes.cols ?? '' } placeholder={ recordingSize ? String( recordingSize.cols ) : __( 'From recording', 'wp-asciiplayer' ) } onChange={ ( value ) => setAttributes( { cols: terminalDimension( value ) } ) } />
			<TextControl label={ __( 'Rows', 'wp-asciiplayer' ) } type="number" min="1" max="1000" step="1" value={ attributes.rows ?? '' } placeholder={ recordingSize ? String( recordingSize.rows ) : __( 'From recording', 'wp-asciiplayer' ) } onChange={ ( value ) => setAttributes( { rows: terminalDimension( value ) } ) } />
		</div>
		<p className="asciiplayer-editor__hint">{ __( 'Placeholders show the recording’s original columns and rows once loaded. Leave blank to follow its terminal size and recorded resize events. These overrides change the character grid, not the display width, and may alter or crop the layout.', 'wp-asciiplayer' ) }</p>
		<Button variant="secondary" onClick={ () => setAttributes( { cols: undefined, rows: undefined } ) }>{ __( 'Use recording size', 'wp-asciiplayer' ) }</Button>
	</>;
}

export default function Edit( { attributes, setAttributes, isSelected } ) {
	const { source, theme, speed, loop, controls, fit, startAt, idleTimeLimit, autoPlay, preload, width, caption, displayAlign } = attributes;
	const [ draftSource, setDraftSource ] = useState( source );
	const [ urlError, setUrlError ] = useState( false );
	const [ mediaError, setMediaError ] = useState( false );
	const [ recording, setRecording ] = useState( null );
	const onRecordingSize = useCallback( ( loadedSource, size ) => setRecording( { source: loadedSource, size } ), [] );
	const [ attempt, setAttempt ] = useState( 0 );
	const [ draftWidth, setDraftWidth ] = useState( width );
	useEffect( () => setDraftWidth( width ), [ width ] );
	useEffect( () => {
		setDraftSource( source );
		setRecording( null );
		setUrlError( Boolean( source.trim() ) && ! normalizeSource( source ) );
	}, [ source ] );
	// Saved/undone sources load immediately. Typed changes wait until the user
	// pauses, and submitting the form applies the same URL without that delay.
	useEffect( () => {
		if ( attributes.isExample || draftSource === source ) return undefined;
		const timer = setTimeout( () => {
			const next = normalizeSource( draftSource );
			setUrlError( Boolean( draftSource.trim() ) && ! next );
			if ( next || ! draftSource.trim() ) setAttributes( { source: next } );
		}, 500 );
		return () => clearTimeout( timer );
	}, [ draftSource, source, attributes.isExample, setAttributes ] );
	const previewSource = normalizeSource( source );
	const showPreview = previewSource && previewSource === normalizeSource( draftSource );
	const recordingSize = showPreview && recording?.source === previewSource ? recording.size : null;
	const blockProps = useBlockProps( { className: 'asciiplayer-editor' } );
	const applySource = ( event ) => {
		event.preventDefault();
		const next = normalizeSource( draftSource );
		setUrlError( ! next );
		if ( ! next ) return;
		setAttributes( { source: next } );
		setDraftSource( next );
		setAttempt( ( current ) => current + 1 );
	};
	const selectRecording = ( media ) => {
		const next = normalizeSource( media?.url );
		if ( ! next || ! /\.cast$/i.test( next.split( /[?#]/ )[ 0 ] ) ) {
			setMediaError( true );
			return;
		}
		setMediaError( false );
		setUrlError( false );
		setRecording( null );
		setDraftSource( next );
		setAttributes( { source: next } );
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
	const widthPresets = [ '100%', '80%', '60%', '50%', '25%' ];
	const widthOptions = [ ...widthPresets.map( ( value ) => ( { label: value, value } ) ), { label: __( 'Custom', 'wp-asciiplayer' ), value: 'custom' } ];
	const [ customWidth, setCustomWidth ] = useState( ! widthPresets.includes( width ) );
	const widthValid = draftWidth.trim() !== '' && normalizeWidth( draftWidth ) === draftWidth.trim() && parseFloat( draftWidth ) > 0;
	const placement = normalizeDisplayAlign( displayAlign );
	const fitOptions = [
		{ label: __( 'Width', 'wp-asciiplayer' ), value: 'width' },
		{ label: __( 'Original size', 'wp-asciiplayer' ), value: 'none' },
	];
	if ( fit === 'height' || fit === 'both' ) fitOptions.push( { label: fit === 'height' ? __( 'Height (legacy)', 'wp-asciiplayer' ) : __( 'Width and height (legacy)', 'wp-asciiplayer' ), value: fit } );
	if ( attributes.isExample ) {
		return <div { ...blockProps }><figure className="asciiplayer-example" aria-label={ __( 'Example terminal recording', 'wp-asciiplayer' ) }><div className="asciiplayer-example__terminal"><span>$ printf 'Hello, terminal!\n'</span><br /><span>Hello, terminal!</span><br /><span>$ <span aria-hidden="true">▋</span></span></div><div className="asciiplayer-example__controls" aria-hidden="true">▶ ━━━━━━━━━━━ 0:00 / 0:12</div><figcaption>{ __( 'A terminal recording, right in your post.', 'wp-asciiplayer' ) }</figcaption></figure></div>;
	}
	return (
		<>
			<BlockControls group="other">
				<BlockAlignmentToolbar value={ placement } controls={ [ 'left', 'center', 'right' ] } onChange={ ( value ) => setAttributes( { displayAlign: normalizeDisplayAlign( value ) } ) } />
				<ToolbarGroup>
					<Dropdown contentClassName="asciiplayer-terminal-popover" popoverProps={ { placement: 'bottom-start' } } renderToggle={ ( { isOpen, onToggle } ) => (
						<ToolbarButton icon="editor-table" label={ __( 'Terminal size', 'wp-asciiplayer' ) } aria-expanded={ isOpen } onClick={ onToggle } />
					) } renderContent={ ( { onClose } ) => (
						<div className="asciiplayer-terminal-popover__content" role="dialog" aria-label={ __( 'Terminal size', 'wp-asciiplayer' ) }>
							<p><strong>{ __( 'Terminal size (columns × rows)', 'wp-asciiplayer' ) }</strong></p>
							<TerminalSizeControls attributes={ attributes } setAttributes={ setAttributes } recordingSize={ recordingSize } />
							<Button variant="tertiary" onClick={ onClose }>{ __( 'Close', 'wp-asciiplayer' ) }</Button>
						</div>
					) } />
				</ToolbarGroup>
			</BlockControls>
			<InspectorControls>
				<PanelBody title={ __( 'Terminal size', 'wp-asciiplayer' ) } initialOpen={ false }>
					<TerminalSizeControls attributes={ attributes } setAttributes={ setAttributes } recordingSize={ recordingSize } />
				</PanelBody>
				<PanelBody title={ __( 'Display', 'wp-asciiplayer' ) }>
					<SelectControl label={ __( 'Player width', 'wp-asciiplayer' ) } value={ customWidth || ! widthPresets.includes( width ) ? 'custom' : width } options={ widthOptions } onChange={ ( value ) => { setCustomWidth( value === 'custom' ); if ( value !== 'custom' ) setAttributes( { width: value } ); } } />
					{ ( customWidth || ! widthPresets.includes( width ) ) && <TextControl label={ __( 'Custom width', 'wp-asciiplayer' ) } value={ draftWidth } help={ widthValid ? __( 'Use a CSS length, such as 480px or 65%. The player stays within its available space.', 'wp-asciiplayer' ) : __( 'Enter a positive width with a unit, such as 480px or 65%. The last valid width is kept.', 'wp-asciiplayer' ) } aria-invalid={ ! widthValid } onChange={ ( value ) => { setDraftWidth( value ); if ( value.trim() && normalizeWidth( value ) === value.trim() && parseFloat( value ) > 0 ) setAttributes( { width: value.trim() } ); } } /> }
					<SelectControl label={ __( 'Display alignment', 'wp-asciiplayer' ) } value={ placement } options={ [ { label: __( 'Left', 'wp-asciiplayer' ), value: 'left' }, { label: __( 'Center', 'wp-asciiplayer' ), value: 'center' }, { label: __( 'Right', 'wp-asciiplayer' ), value: 'right' } ] } onChange={ ( value ) => setAttributes( { displayAlign: value } ) } />
					<p>{ __( 'Display width scales the recording without changing its terminal columns or rows. Add a caption directly below the player.', 'wp-asciiplayer' ) }</p>
				</PanelBody>

				<PanelBody title={ __( 'Playback', 'wp-asciiplayer' ) }>
					<RangeControl label={ __( 'Playback speed', 'wp-asciiplayer' ) } value={ speed } min={ 0.25 } max={ Math.max( 8, speed ) } step={ 0.25 } onChange={ ( value ) => setAttributes( { speed: finiteNumber( value, 1, 0.01, 100 ) } ) } />
					<ToggleControl label={ __( 'Loop playback', 'wp-asciiplayer' ) } checked={ loop } onChange={ ( value ) => setAttributes( { loop: value } ) } />
					<ToggleControl label={ __( 'Autoplay on published page', 'wp-asciiplayer' ) } help={ __( 'The editor preview always waits for you to press play.', 'wp-asciiplayer' ) } checked={ autoPlay } onChange={ ( value ) => setAttributes( { autoPlay: value } ) } />
					<ToggleControl label={ __( 'Preload on published page', 'wp-asciiplayer' ) } help={ __( 'Loads the recording before the visitor presses play. The editor preview always preloads a valid recording URL.', 'wp-asciiplayer' ) } checked={ preload } onChange={ ( value ) => setAttributes( { preload: value } ) } />
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
					{ attributes.legacyStyle && <p>{ __( 'The custom container style from your shortcode is preserved on the published page.', 'wp-asciiplayer' ) }</p> }
				</PanelBody>
				<PanelBody title={ __( 'Help', 'wp-asciiplayer' ) } initialOpen={ false }>
					<p className="asciiplayer-editor__privacy">{ __( 'A valid recording URL loads its preview automatically, including when reopening this editor. That server receives your browser’s request. Published players contact the same server. Use a direct .cast URL; external servers must allow CORS.', 'wp-asciiplayer' ) }</p>
					<p className="asciiplayer-editor__hint">{ __( 'Use the player controls to play, pause, and seek. Autoplay is disabled only in the editor.', 'wp-asciiplayer' ) }</p>
				</PanelBody>
			</InspectorControls>
			<div { ...blockProps }>
				<div className="asciiplayer-editor__source">
					<form onSubmit={ applySource }>
						<TextControl label={ __( 'Recording URL', 'wp-asciiplayer' ) } placeholder="https://example.com/recording.cast" value={ draftSource } onChange={ ( value ) => { setDraftSource( value ); setUrlError( false ); setMediaError( false ); } } autoComplete="off" />
						<Button type="submit" variant="primary">{ __( 'Apply URL', 'wp-asciiplayer' ) }</Button>
					</form>
					<MediaUploadCheck>
						<MediaUpload title={ __( 'Choose an Asciicast recording', 'wp-asciiplayer' ) } allowedTypes={ [ 'application/x-asciicast', 'text/plain', 'application/json', 'application/octet-stream', 'application/jsonl', 'application/x-ndjson' ] } multiple={ false } onSelect={ selectRecording } render={ ( { open } ) => (
							<Button className="asciiplayer-editor__media" variant="secondary" onClick={ open }>{ __( 'Choose recording', 'wp-asciiplayer' ) }</Button>
						) } />
					</MediaUploadCheck>
					{ mediaError && <Notice status="error" isDismissible={ false }>{ __( 'Choose an Asciicast (.cast) file from the Media Library.', 'wp-asciiplayer' ) }</Notice> }
					{ urlError && <Notice status="error" isDismissible={ false }>{ __( 'Enter an HTTP(S) recording URL or a path starting with a single /.', 'wp-asciiplayer' ) }</Notice> }
				</div>
				<figure className={ `asciiplayer-figure asciiplayer-align-${ placement }` } style={ { width: normalizeWidth( width ) } }>
				{ showPreview ? (
					<>
						<Preview source={ previewSource } attributes={ attributes } attempt={ attempt } onRecordingSize={ onRecordingSize } onRetry={ () => setAttempt( ( current ) => current + 1 ) } />
					</>
				) : (
					<Placeholder icon="editor-code" label={ __( 'Asciicast Player', 'wp-asciiplayer' ) } instructions={ __( 'Enter a recording URL to load its preview automatically. Playback starts only when you press play.', 'wp-asciiplayer' ) } />
				) }
				<RichText tagName="figcaption" className={ `wp-element-caption${ ! isSelected && ! caption ? ' asciiplayer-caption-empty' : '' }` } value={ caption } allowedFormats={ [] } onChange={ ( value ) => setAttributes( { caption: value } ) } placeholder={ __( 'Add a caption…', 'wp-asciiplayer' ) } aria-label={ __( 'Recording caption', 'wp-asciiplayer' ) } />
				</figure>
				{ [ 'height', 'both' ].includes( fit ) && <p className="asciiplayer-editor__hint">{ __( 'Height-based previews use the shortcode’s fixed height when available, or a 320px editor frame. Published height still comes from your container style.', 'wp-asciiplayer' ) }</p> }
			</div>
		</>
	);
}
