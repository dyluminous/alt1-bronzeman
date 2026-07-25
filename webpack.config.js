const path = require("path");

/**
 * @type {import("webpack").Configuration}
 */
module.exports = {
    context: path.resolve(__dirname, "src"),
    entry: {
        "main": "./index.ts"
    },
    output: {
        path: path.resolve(__dirname, "dist"),
        library: { type: "umd", name: "Bronzeman" }
    },
    devtool: false,
    mode: "development",
    externals: [
        "sharp",
        "canvas",
        "electron/common"
    ],
    resolve: {
        extensions: [".wasm", ".tsx", ".ts", ".mjs", ".jsx", ".js"]
    },
    module: {
        rules: [
            { test: /\.tsx?$/, loader: "ts-loader" },
            { test: /\.css$/, use: ["style-loader", "css-loader"] },
            { test: /\.scss$/, use: ["style-loader", "css-loader", "sass-loader"] },
            { test: /\.(png|jpg|jpeg|gif|webp)$/, type: "asset/resource", generator: { filename: "[base]" } },
            { test: /\.(html|json)$/, type: "asset/resource", generator: { filename: "[base]" } },
            { test: /\.data\.png$/, loader: "alt1/imagedata-loader", type: "javascript/auto" },
            { test: /\.fontmeta.json/, loader: "alt1/font-loader" }
        ]
    }
}
