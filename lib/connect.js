/* vim: set ts=8 sts=8 sw=8 noet: */

var mod_util = require('util');
var mod_os = require('os');
var mod_net = require('net');
var mod_events = require('events');

var mod_bunyan = require('bunyan');
var mod_restify = require('restify');
var mod_assert = require('assert-plus');
var mod_watershed = require('watershed');
var mod_backoff = require('backoff');

var lib_common = require('../lib/common');
var lib_jsonstore = require('../lib/jsonstore');

var PROGNAME = 'loadgen_client';

var WATERSHED = new mod_watershed.Watershed();

var CLIENT;
var SHED;


function
Connection(options)
{
	var self = this;
	mod_events.EventEmitter.call(self);

	mod_assert.string(options.host, 'options.host');
	mod_assert.number(options.port, 'options.port');
	mod_assert.object(options.log, 'options.log');

	self.c_host = options.host;
	self.c_port = options.port;
	self.c_log = options.log;

	self.c_client = mod_restify.createHttpClient({
		url: 'http://' + options.host + ':' + options.port,
		log: options.log,
		retry: false,
		agent: false
	});

	self.c_backoff = mod_backoff.fibonacci({
		randomisationFactor: 0.5,
		initialDelay: 1000,
		maxDelay: 30000
	});

	self.c_backoff.on('backoff', function (number, delay) {
		self.c_log.info({
			number: number,
			delay: delay
		}, 'backoff');
	});

	self.c_backoff.on('ready', function () {
		self._connect();
	});

	self.c_last_ping = 0;
	self.c_interval = setInterval(function () {
		if (!self.c_shed)
			return;

		if (self.c_last_ping++ >= 3) {
			self.c_log.warn('3 missed pings; destroying');
			self.c_shed.destroy();
			return;
		}

		self.c_shed.send('ping');
	}, 8000);

	/*
	 * Kick off continuous connection:
	 */
	self.c_backoff.backoff();
}
mod_util.inherits(Connection, mod_events.EventEmitter);

Connection.prototype._new_shed = function
_new_shed(shed)
{
	var self = this;

	mod_assert.ok(!self.c_shed, 'duplicate shed?');

	self.c_shed = shed;

	self.c_shed.on('text', function (text) {
		if (text === 'ping') {
			self.c_last_ping = 0;
			return;
		}

		var msg;
		try {
			msg = JSON.parse(text);
		} catch (ex) {
			self.c_log.error({
				err: ex
			}, 'server JSON parse error');
			self.c_shed.destroy();
			return;
		}

		self.emit('message', msg);
	});

	self.c_shed.once('error', function (err) {
		self.c_log.error({
			err: err
		}, 'watershed error');
	});

	self.c_shed.once('end', function () {
		self.c_log.info('connection ends');
		self.c_shed = null;
		self.emit('disconnected');
		self.c_backoff.backoff();
	});

	self.emit('connected');
};

Connection.prototype._connect = function
_connect()
{
	var self = this;

	var wskey = WATERSHED.generateKey();
	var options = {
		path: '/attach/' + mod_os.hostname(),
		headers: {
			connection: 'upgrade',
			upgrade: 'websocket',
			'sec-websocket-key': wskey
		}
	};

	self.c_client.get(options, function (err, req) {
		if (err) {
			self.c_log.error({
				err: err
			}, 'attach request error');
			self.c_backoff.backoff(err);
			return;
		}

		req.once('upgradeResult', function (_err, res, socket, head) {
			if (_err) {
				self.c_log.error({
					err: _err
				}, 'attach request error');
				self.c_backoff.backoff(_err);
				return;
			}

			self.c_log.info({ res: res }, 'response');

			var shed = WATERSHED.connect(res, socket, head, wskey);

			self._new_shed(shed);
		});
		req.once('result', function (_err, res) {
			if (_err) {
				self.c_log.error({
					err: _err
				}, 'attach request error');
				self.c_backoff.backoff(_err);
				return;
			}

			self.c_log.error('server did not upgrade');
			self.c_backoff.backoff();
			return;
		});
	});
};

Connection.prototype.post = function
post(msg)
{
	var self = this;

	if (self.c_shed) {
		self.c_shed.send(JSON.stringify(msg));
	}
};

Connection.prototype.reset = function
reset()
{
	var self = this;

	self.c_log.info('connection reset by consumer');

	if (self.c_shed) {
		self.c_shed.destroy();
		return;
	}
};

Connection.prototype.ok = function
ok()
{
	var self = this;

	self.c_log.info('connection marked ok');

	self.c_backoff.reset();
};

module.exports = {
	Connection: Connection
};
