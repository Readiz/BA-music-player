const glob = require('glob-promise');
const fse = require('fs-extra');

const writeFileSync = (filepath, str) => {
    try {
        fse.outputFile(filepath, str);
    } catch (e) {
        console.error('Writing Error', filepath);
    }
}

console.log('Starting...');
(async () => {
    let paths = await glob.promise('./music/*', {});
    paths = paths.map(item => encodeURI(item));
    console.log(paths);
    writeFileSync('./musicList.json', JSON.stringify(paths, null, 2));
    writeFileSync('./lastUpdated.txt', String(new Date()));
})();