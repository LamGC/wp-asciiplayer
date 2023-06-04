import path from 'path';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';

export default {
  entry: './src/index.js',
  mode: "production",
  output: {
    path: path.resolve('./dist'),
    filename: 'bundle.js',
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: 'styles.css'
    })
  ]
};