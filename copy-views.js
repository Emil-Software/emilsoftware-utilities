const fs = require("fs-extra");
const path = require("path");

// I componenti in src/angular-components sono frameworkless: JS e CSS devono
// arrivare in dist cosi' come sono, senza passare da tsc.
const SOURCE_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs"]);

async function collectFiles(directory, baseDirectory = directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            files.push(...(await collectFiles(fullPath, baseDirectory)));
            continue;
        }

        if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            files.push(path.relative(baseDirectory, fullPath));
        }
    }

    return files;
}

async function copyHtmlFiles() {
    const srcDir = path.join(__dirname, "src");
    const distDir = path.join(__dirname, "dist");

    try {
        const files = await collectFiles(srcDir);

        for (const file of files) {
            await fs.copy(path.join(srcDir, file), path.join(distDir, file));
        }
    } catch (error) {
        console.error("Errore nella copia degli asset HTML/CSS/JS:", error);
        process.exit(1);
    }
}

copyHtmlFiles();
