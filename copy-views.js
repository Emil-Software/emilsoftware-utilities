const fs = require("fs-extra");
const path = require("path");
const glob = require("glob");

async function copyHtmlFiles() {
    const srcDir = path.join(__dirname, "src");
    const distDir = path.join(__dirname, "dist");

    glob("**/*.{html,css}", { cwd: srcDir }, async (err, files) => {
        if (err) {
            console.error("Errore nella ricerca dei file HTML:", err);
            process.exit(1);
        }

        if (files.length === 0) {
            return;
        }

        try {
            // Copia ogni file HTML mantenendo la struttura delle cartelle
            for (const file of files) {
                const srcPath = path.join(srcDir, file);
                const destPath = path.join(distDir, file);
                await fs.copy(srcPath, destPath);
            }
        } catch (err) {
            console.error("Errore nella copia dei file HTML:", err);
            process.exit(1);
        }
    });
}

copyHtmlFiles();
