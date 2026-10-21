/* eslint-disable import/no-dynamic-require -- Resolve pinned electron-builder internal helpers from its installed package. */
/* eslint-disable sonar/class-prototype -- Scope the builder-owned VM operation to official NSIS extraction during this CLI process only. */
/* eslint-disable no-console -- Print command-line artifact paths and build errors. */
// Finish a Linux cross-build from an already prepared Windows application.
// electron-builder's own NSIS reader can extract the generated uninstaller
// without running Wine. This does not replace or simulate the installed app.
const fs = require('node:fs');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');

const builderRoot = path.dirname(require.resolve('electron-builder'));
const library = path.dirname(
  require.resolve('app-builder-lib', { paths: [builderRoot] }),
);
const { WineVmManager } = require(path.join(library, 'vm/WineVm'));
const { UninstallerReader } = require(
  path.join(library, 'targets/nsis/nsisUtil'),
);
const output = path.resolve('out');
const prepared = path.join(output, 'win-unpacked');
if (process.platform !== 'linux')
  throw new Error('Use the standard build:windows command on Windows.');
if (!fs.existsSync(path.join(prepared, 'resources/app.asar')))
  throw new Error('Prepare the Windows app before finishing its installer.');

WineVmManager.prototype.exec = async function extractGeneratedUninstaller(
  file,
  args = [],
) {
  if (
    path.dirname(path.resolve(file)) !== output ||
    !path.basename(file).startsWith('ZL-WA-win-AutoSetup-') ||
    args.length > 0
  )
    throw new Error(
      'Unexpected Wine request; only this build’s generated NSIS uninstaller is supported.',
    );
  const destination = path.join(
    output,
    `${path.basename(file, 'exe')}__uninstaller.exe`,
  );
  await UninstallerReader.exec(file, destination);
  const header = fs.readFileSync(destination);
  if (header.length < 100_000 || header[0] !== 0x4d || header[1] !== 0x5a)
    throw new Error('The generated uninstaller is invalid.');
};

build({
  targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.x64),
  prepackaged: prepared,
  publish: 'never',
})
  .then(files => {
    for (const file of files) console.log(file);
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
