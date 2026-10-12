const path = require('path');
const config = require('@wordpress/scripts/config/webpack.config');
module.exports = {
  ...config,
  entry: { index: path.resolve(__dirname, 'src/index.js'), view: path.resolve(__dirname, 'src/view.js') },
  output: { ...config.output, path: path.resolve(__dirname, 'build') },
};
