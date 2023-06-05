# wp-asciiplayer-adapter

This library needs to be used with the WordPress Ascicast Player plugin.

## How to work

The Asciicast Player plugin will generate a div element containing the parameters required for asciicast playback for the asciiplayer short code in the post:

```html
<div class="asciiplayer-container" 
     data-ap-src="https://asciinema.org/a/28307.cast" 
     data-ap-opts="%7B%22fit%22%3A%22width%22%2C%22preload%22%3Atrue%7D">
</div>
```

Then, the adapter will search for these div elements and use [asciinema-player](https://www.npmjs.com/package/asciinema-player) to create an Asciicast player within the div elements.
