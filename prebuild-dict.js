const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'src/assets/word.bin');
const destDir = path.join(__dirname, 'android/app/src/main/assets');
const partsDir = path.join(destDir, 'dict_parts');

if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
if (!fs.existsSync(partsDir)) fs.mkdirSync(partsDir, { recursive: true });

console.log('Reading word.bin...');
const content = fs.readFileSync(srcPath, 'utf8');
const parsed = JSON.parse(content);

console.log('Generating parts...');
const groups = {};
const getPrefix = (key) => {
  const rawName = key.substring(2).trim().toLowerCase();
  const cleanName = rawName.replace(/^-|-$/g, '').replace(/[\\\\/]/g, '_');
  if (cleanName.length === 0) return '_empty';
  if (cleanName.length === 1) return cleanName;
  return cleanName.substring(0, 2);
};

const keys = Object.keys(parsed);
for (const key of keys) {
  const prefix = getPrefix(key);
  if (!groups[prefix]) groups[prefix] = {};
  groups[prefix][key] = parsed[key];
}

for (const prefix in groups) {
  fs.writeFileSync(path.join(partsDir, `${prefix}.json`), JSON.stringify(groups[prefix]));
}

console.log('Generating index and previews...');
const words = [];
const roots = [];
for (const key of keys) {
  if (key.startsWith('W:')) {
    const entry = parsed[key];
    words.push({
      id: key,
      title: entry.word || key.substring(2),
      meaning: entry.primary_meaning || entry.meaning || '',
    });
  } else if (key.startsWith('R:')) {
    const entry = parsed[key];
    roots.push({
      id: key,
      title: entry.segment || key.substring(2),
      meaning: entry.meaning || '',
      type: entry.type || '词根',
    });
  }
}

words.sort((a, b) => a.title.localeCompare(b.title));
roots.sort((a, b) => a.title.localeCompare(b.title));

const indexDestDir = path.join(__dirname, 'src/assets');

fs.writeFileSync(path.join(indexDestDir, 'offline_words_index.json'), JSON.stringify(words));
fs.writeFileSync(path.join(indexDestDir, 'offline_roots_index.json'), JSON.stringify(roots));

fs.writeFileSync(path.join(indexDestDir, 'offline_words_preview.json'), JSON.stringify(words.slice(0, 200)));
fs.writeFileSync(path.join(indexDestDir, 'offline_roots_preview.json'), JSON.stringify(roots.slice(0, 200)));

console.log('Prebuild complete!');
