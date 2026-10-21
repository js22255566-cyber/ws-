// Preserve pnpm's CommonJS aliases that electron-builder's collector omits.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

exports.default = async context => {
  const root = context.packager.projectDir;
  const output = path.join(root, 'build-runtime', 'node_modules');
  fs.mkdirSync(output, { recursive: true });
  const store = path.join(root, 'node_modules', '.pnpm');
  const copyPackage = (source, target) => {
    fs.mkdirSync(target, { recursive: true });
    for (const item of fs.readdirSync(source, { withFileTypes: true })) {
      if (item.name !== 'node_modules')
        fs.cpSync(path.join(source, item.name), path.join(target, item.name), {
          recursive: true,
          dereference: true,
        });
    }
    const info = JSON.parse(
      fs.readFileSync(path.join(source, 'package.json'), 'utf8'),
    );
    const req = createRequire(path.join(source, 'package.json'));
    for (const name of Object.keys(info.dependencies || {})) {
      const dep = path.dirname(req.resolve(`${name}/package.json`));
      copyPackage(dep, path.join(target, 'node_modules', name));
    }
  };
  for (const [alias, name, version] of [
    ['string-width-cjs', 'string-width', '4.2.3'],
    ['strip-ansi-cjs', 'strip-ansi', '6.0.1'],
  ]) {
    const entry = fs
      .readdirSync(store)
      .find(
        item =>
          item === `${name}@${version}` ||
          item.startsWith(`${name}@${version}_`),
      );
    if (!entry)
      throw new Error(
        `Missing locked runtime alias: ${alias} (${name}@${version})`,
      );
    copyPackage(
      path.join(store, entry, 'node_modules', name),
      path.join(output, alias),
    );
  }
};
