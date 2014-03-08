/* vim: set ts=8 sts=8 sw=8 noet: */

var mod_fs = require('fs');
var mod_path = require('path');
var mod_assert = require('assert-plus');
var mod_jsprim = require('jsprim');

var CONFIG;

function
read_config(name, required)
{
	if (!CONFIG) {
		var path = mod_path.join(__dirname, '..', 'etc', 'server.json');
		CONFIG = JSON.parse(mod_fs.readFileSync(path));
	}

	var out = mod_jsprim.pluck(CONFIG, name);

	if (required && typeof (out) === 'undefined') {
		throw (new Error('require "' + name + '" in etc/server.json'));
	}

	return (out);
}

module.exports = {
	read_config: read_config
};
