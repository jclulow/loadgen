/* vim: set ts=8 sts=8 sw=8 noet: */

var mod_util = require('util');
var mod_os = require('os');
var mod_path = require('path');
var mod_child = require('child_process');

var mod_bunyan = require('bunyan');
var mod_restify = require('restify');
var mod_assert = require('assert-plus');
var mod_watershed = require('watershed');

var lib_common = require('../lib/common');
var lib_jsonstore = require('../lib/jsonstore');
var lib_connect = require('../lib/connect');

var PROGNAME = 'loadgen_client';

var STATE_FILE = mod_path.join(__dirname, '..', 'statefile.json');
var STATE;

var PROC;

var WATERSHED = new mod_watershed.Watershed();

var LOG = mod_bunyan.createLogger({
	name: PROGNAME,
	serializers: mod_bunyan.stdSerializers,
	level: process.env.LOG_LEVEL || 'info'
});

var CONN;

var IDENTITY_FUNCS = [
	'endianness',
	'hostname',
	'totalmem',
	'cpus.length',
	'type',
	'release',
	'arch',
	'platform'
];

function
identity(callback)
{
	var out = {};

	for (var i = 0; i < IDENTITY_FUNCS.length; i++) {
		var idfunc = IDENTITY_FUNCS[i];
		var m = idfunc.match(/(.+)\.length$/);
		if (m) {
			out[m[1]] = mod_os[m[1]]().length;
		} else {
			out[idfunc] = mod_os[idfunc]();
		}
	}

	callback(null, out);
}

var IN_WRITE = false;
function
write_state_file(next)
{
	mod_assert.ok(!IN_WRITE);
	IN_WRITE = true;

	lib_jsonstore.write_json_file(STATE_FILE, STATE, function (err) {
		if (err) {
			LOG.error({
				err: err
			}, 'could not write state file');
		}

		IN_WRITE = false;

		if (next)
			next();
	});
}

var RUNNING = false;

function
run_job()
{
	mod_assert.ok(!RUNNING);
	RUNNING = true;

	STATE.running = true;

	LOG.info({
		command: STATE.command,
		args: STATE.args
	}, 'running job');

	var stdout = '';
	var stderr = '';

	var has_done = false;
	var done = function () {
		if (has_done)
			return;
		has_done = true;

		STATE.completed = true;
		STATE.running = true;

		LOG.info({
			state: STATE
		}, 'job run complete');

		write_state_file(function () {
			RUNNING = false;
			PROC = null;

			/*
			 * Send results to the server.
			 */
			CONN.post({
				type: 'status',
				state: STATE
			});
		});
	};

	mod_assert.ok(!PROC);
	PROC = mod_child.spawn(STATE.command, STATE.args, {
		cwd: '/var/tmp'
	});
	
	PROC.stdin.end();

	PROC.stderr.on('readable', function () {
		for (;;) {
			var buf = PROC.stderr.read(100);
			if (!buf)
				return;
			stderr += buf.toString();
		}
	});
	PROC.stdout.on('readable', function () {
		for (;;) {
			var buf = PROC.stdout.read(100);
			if (!buf)
				return;
			stdout += buf.toString();
		}
	});

	PROC.on('close', function (code, signal) {
		STATE.code = code;
		STATE.signal = signal;
		STATE.stdout = stdout;
		STATE.stderr = stderr;

		done();
	});

	PROC.on('error', function (err) {
		STATE.error = err.stack;

		done();
	});
}

function
main()
{
	CONN = new lib_connect.Connection({
		host: 'localhost',
		port: Number(lib_common.read_config('listen.port')),
		log: LOG.child({
			component: 'Connection'
		})
	});

	CONN.on('message', function (msg) {
		if (msg.type === 'hello') {
			CONN.post({
				type: 'hello'
			});
			CONN.ok();
			return;

		} else if (msg.type === 'discard') {
			STATE = {
				job: null,
				running: false,
				completed: false
			};
			write_state_file(function () {
				CONN.post({
					type: 'need_work'
				});
			});
			return;

		} else if (msg.type === 'schedule') {
			if (STATE.job)
				return;

			STATE = msg.state;

			STATE.running = false;
			STATE.completed = false;

			write_state_file(function () {
				run_job();
			});
			return;

		}

		LOG.info({
			message: msg
		}, 'received message');
	});

	CONN.on('connected', function () {
		LOG.info('connected');

		identity(function (err, obj) {
			if (err) {
				LOG.error({
					err: err
				}, 'identity error');
				CONN.reset();
				return;
			}

			CONN.post({
				type: 'identity',
				identity: obj
			});
		});

		if (STATE.job) {
			CONN.post({
				type: 'status',
				state: STATE
			});
		} else {
			CONN.post({
				type: 'need_work'
			});
		}
	});

	CONN.on('disconnected', function () {
		LOG.info('disconnected');
	});
}

lib_jsonstore.read_json_file(STATE_FILE, function (err, obj) {
	if (err) {
		LOG.error({
			err: err
		}, 'error reading JSON store');
		process.exit(1);
	}

	STATE = obj ? obj : {
		job: null,
		running: false,
		completed: false
	};

	STATE.running = false;

	if (STATE.job && !STATE.completed)
		run_job();

	LOG.info({
		state: STATE
	}, 'load state');

	main();
});
