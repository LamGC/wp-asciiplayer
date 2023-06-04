import * as AsciinemaPlayer from "asciinema-player";
import "asciinema-player/dist/bundle/asciinema-player.css";
import "../styles/default-player.css";

const defaultOpts = {
    preload: true,
    fit: "width"
}

document.addEventListener('DOMContentLoaded', () => {
    const containers = document.getElementsByClassName("asciiplayer-container");
    for (const container of containers) {
        const castSource = container.dataset["apSrc"];
        const containerStyle = container.dataset["apStyle"];
        if (!castSource) {
            console.warn(`asciiplayer: container ${container.id} has no data-ap-src attribute, skip.`);
            continue;
        }
        let encodedOptions = container.dataset["apOpts"];
        let options = defaultOpts;
        if (encodedOptions) {
            try {
                options = mergeOptions(defaultOpts, JSON.parse(decodeURIComponent(encodedOptions)));
            } catch (err) {
                console.error("asciiplayer: failed to parse data-ap-options, skip.", err);
                continue;
            }
        }
        if (containerStyle) {
            container.setAttribute("style", containerStyle);
            delete container.dataset["apStyle"];
        }
        // noinspection JSCheckFunctionSignatures - create 中会判断是否为三个函数.
        AsciinemaPlayer.create(castSource, container, options);
    }
});

/**
 *
 * @param defaults {Object}
 * @param opts {Object}
 */
function mergeOptions(defaults, opts) {
    let result = {};
    for (const key of Object.keys(defaults)) {
        result[key] = defaults[key];
    }
    for (const key of Object.keys(opts)) {
        result[key] = opts[key];
    }
    return result;
}
