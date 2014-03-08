/* vim: set ts=8 sts=8 sw=8 noet: */

var mod_os = require('os');

var mod_bunyan = require('bunyan');
var mod_restify = require('restify');
var mod_assert = require('assert-plus');
var mod_watershed = require('watershed');

var lib_common = require('../lib/common');

var PROGNAME = 'loadgen_client';

var WATERSHED = new mod_watershed.Watershed();

var LOG = mod_bunyan.createLogger({
	name: PROGNAME,
	serializers: mod_bunyan.stdSerializers,
	level: process.env.LOG_LEVEL || 'info'
});

var CLIENT;
var SHED;

function
connect(callback)
{
	var wskey = WATERSHED.generateKey();

	var options = {
		path: '/attach/' + mod_os.hostname(),
		headers: {
			connection: 'upgrade',
			upgrade: 'websocket',
			'sec-websocket-key': wskey
		}
	};

	CLIENT.get(options, function (err, req) {
		req.once('upgradeResult', function (err, res, socket, head) {
			if (err) {
				LOG.error({
					err: err
				}, 'attach request error');
				callback(new Error());
				return;
			}

			LOG.info({ res: res }, 'response');

			var shed = WATERSHED.connect(res, socket, head, wskey);

			callback(null, shed);
		});
		req.once('result', function (err, res) {
			if (err) {
				LOG.error({
					err: err
				}, 'attach request error');
				callback(new Error());
				return;
			}

			LOG.error('server did not upgrade');
			callback(new Error());
			return;
		});
	});
}


(function
main()
{
	CLIENT = mod_restify.createHttpClient({
		url: 'http://localhost:' + lib_common.read_config('listen.port'),
		log: LOG.child({
			component: 'restify'
		})
	});

	connect(function (err, shed) {
		if (err) {
			process.exit(1);
		}

		SHED = shed;

		var send = function (obj) {
			SHED.send(JSON.stringify(obj));
		};

		LOG.info({
			remote: SHED._remote
		}, 'connected');

		SHED.on('text', function (text) {
			var obj = JSON.parse(text);

			switch (obj.type) {
			case 'hello':
				send({
					type: 'hello'
				});
				setInterval(function () {
					send({
						type: 'status',
						now: (new Date()).toISOString()
					});
				}, 1000);
				break;
			default:
				LOG.info({
					obj: obj
				}, 'text!');
			}
		});
	});
})();
