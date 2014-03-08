/* vim: set ts=8 sts=8 sw=8 noet: */

var mod_bunyan = require('bunyan');
var mod_restify = require('restify');
var mod_assert = require('assert-plus');
var mod_watershed = require('watershed');

var lib_common = require('../lib/common');

var PROGNAME = 'loadgen_server';

var WATERSHED = new mod_watershed.Watershed();

var LOG = mod_bunyan.createLogger({
	name: PROGNAME,
	serializers: mod_bunyan.stdSerializers,
	level: process.env.LOG_LEVEL || 'info'
});

var CLIENTS = [];

function
find_client(name)
{
	for (var i = 0; i < CLIENTS.length; i++) {
		var client = CLIENTS[i];

		if (client.cl_name === name)
			return (client);
	}

	return (null);
}

function
register_client(name, shed, callback)
{
	var log = LOG.child({
		client: name,
		remote: shed._remote
	});
	var client = find_client(name);

	if (!client) {
		log.info('registering new client');
		client = {
			cl_name: name,
			cl_shed: shed,
			cl_first_conn: Date.now(),
			cl_last_conn: Date.now()
		};
		CLIENTS.push(client);
	} else if (client.cl_shed) {
		/*
		 * The client is already connected -- terminate the old
		 * connection in favour of this new one.
		 */
		log.info({
			old_remote: client.cl_shed._remote
		}, 'replacing old client connection');
		client.cl_shed.removeAllListeners();
		client.cl_shed.destroy();
		client.cl_shed = shed;
		client.cl_last_conn = Date.now();
	} else {
		/*
		 * Extant client, but no current connection:
		 */
		log.info('client reconnected');
		client.cl_shed = shed;
		client.cl_state = 'NEW';
		client.cl_last_conn = Date.now();
	}

	/*
	 * Initialise client connection:
	 */
	shed.on('error', function (err) {
		log.error({
			err: err
		}, 'websocket error');
	});
	shed.on('end', function () {
		log.info('client closed connection');
		client.cl_shed = null;
	});
	shed.send(JSON.stringify({
		type: 'hello'
	}));

	var hello_count = 0;
	shed.on('text', function (text) {
		var obj = JSON.parse(text);

		switch (obj.type) {
		case 'hello':
			if (++hello_count === 1) {
				log.info('received hello');
				setImmediate(callback);
			}
			break;
		case 'status':
			log.info({
				status: obj
			}, 'client status');
			break;
		}
	});
}

function
handle_info(req, res, next)
{
	res.send(200, {
		message: 'ok'
	});
	next();
}

function
handle_attach(req, res, next)
{
	var name = req.params.name;

	if (!res.claimUpgrade) {
		req.log.error('client did not upgrade');
		res.send(400);
		next(false);
		return;
	}

	var upgrade = res.claimUpgrade();
	var shed = WATERSHED.accept(req, upgrade.socket, upgrade.head);

	register_client(name, shed, function (err) {
		if (err) {
			req.log.error({
				err:  err
			}, 'client registration error');
			return;
		}
	});

	next(false);
}

function
create_server(callback)
{
	var port = lib_common.read_config('listen.port', true);
	var ip = lib_common.read_config('listen.ip') || '0.0.0.0';

	var s = mod_restify.createServer({
		name: PROGNAME,
		handleUpgrades: true,
		log: LOG.child({
			component: 'restify'
		})
	});

	s.get('/info', handle_info);
	s.get('/attach/:name', handle_attach);

	s.listen(port, ip, callback);
}

(function
main()
{
	create_server(function (err) {
		if (err) {
			LOG.fatal({
				err: err
			}, 'could not init http server');
			process.exit(1);
		}

		LOG.info('server started');
	});
})();
