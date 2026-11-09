import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options });
const compose = (...args) => run('docker', ['compose', ...args]);
const action = process.argv[2];
switch (action) {
  case 'start':
    if (!existsSync('.env')) copyFileSync('.env.example', '.env');
    if (!existsSync('secrets/jwt_private.pem'))
      run(process.execPath, ['backend/shared/auth/scripts/gen-keys.mjs']);
    compose('up', '-d', '--wait', 'postgres', 'redis', 'rabbitmq');
    // Existing pre-B-14 volumes have an empty notification DB. Upgrade that DB without resets.
    compose(
      'exec',
      '-T',
      'postgres',
      'bash',
      '-ec',
      `db="\${NOTIFICATION_DB_NAME:-notification_db}"; present=$(psql -U "$POSTGRES_USER" -d "$db" -tAc "SELECT to_regclass('public.notifications') IS NOT NULL"); if [ "$present" = "f" ]; then psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db" -f /database/notification/001_schema.sql -f /database/notification/002_seed.sql; fi`,
    );
    compose('up', '-d', '--build', '--wait', '--wait-timeout', '300');
    break;
  case 'reset':
    if (!process.argv.includes('--confirm'))
      throw new Error(
        'Reset deletes all local auction data. Run npm run reset-db -- --confirm to proceed.',
      );
    compose('down', '-v');
    compose('up', '-d', '--wait', '--wait-timeout', '300');
    break;
  case 'seed':
    // Seeds use ON CONFLICT and run in their owning databases; schemas already exist.
    compose(
      'exec',
      '-T',
      'postgres',
      'bash',
      '-ec',
      'for service in auth auction bidding payment notification; do variable="${service^^}_DB_NAME"; db="${!variable:-${service}_db}"; for sql in /database/"$service"/*_seed.sql; do [ -f "$sql" ] || continue; psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db" -f "$sql"; done; done',
    );
    break;
  case 'demo':
    run(process.execPath, ['--test', 'tests/e2e/lifecycle.e2e.mjs'], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: resolve('gateway/certs/cert.pem') },
    });
    break;
  case 'package': {
    // Explicit tracked-file allowlist from Git excludes ignored secrets and generated output.
    // Archive HEAD so the ZIP always names a reproducible, committed submission.
    if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) {
      throw new Error('Commit the verified source before packaging.');
    }
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n');
    if (
      files.some((file) =>
        /(^|\/)(node_modules|dist|coverage|secrets|temp|\.claude)(\/|$)|(^|\/)\.env$|\.(pem|key|crt|p12)$/.test(
          file,
        ),
      )
    ) {
      throw new Error(
        'A generated or secret file is tracked; remove it from Git before packaging.',
      );
    }
    mkdirSync('dist', { recursive: true });
    run('git', [
      'archive',
      '--format=zip',
      '--prefix=online-auction-platform/',
      '--output=dist/online-auction-platform.zip',
      'HEAD',
    ]);
    process.stdout.write('Created dist/online-auction-platform.zip from HEAD\n');
    break;
  }
  default:
    throw new Error('Expected start, reset, seed, demo or package');
}
