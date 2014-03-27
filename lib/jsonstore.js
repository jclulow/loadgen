/* vim: set ts=8 sts=8 sw=8 noet: */

var mod_fs = require('fs');
var mod_path = require('path');
var mod_assert = require('assert-plus');
var mod_jsprim = require('jsprim');
var mod_vasync = require('vasync');
var mod_verror = require('verror');

var MODE_DIR = 0750;
var MODE_FILE = 0640;

var VError = mod_verror.VError;

/*
 * When atomically renaming a file, it is critical to fsync(2) the _directory_
 * to disk for the metadata change to be durable.  This function opens a
 * directory, fsyncs it, then closes it again.
 */
function
sync_directory(dirname, callback)
{
	mod_assert.string(dirname);
	mod_assert.func(callback);

	mod_fs.open(dirname, 'r', MODE_DIR, function (err, fd) {
		if (err) {
			err = new VError(err, 'could not open "%s"', dirname);
			callback(err);
			return;
		}

		mod_fs.fsync(fd, function (_err) {
			if (_err) {
				_err = new VError(_err, 'could not fsync %d',
				    fd);
			}
			/*
			 * Always close the file descriptor:
			 */
			mod_fs.close(fd, function (__err) {
				if (_err) {
					callback(_err);
					return;
				}

				if (__err) {
					__err = new VError(__err, 'could ' +
					    'not close fd %d', fd);
				}

				callback(__err);
			});
		});
	});
}

function
atomic_rename(oldname, newname, callback)
{
	mod_assert.string(oldname);
	mod_assert.string(newname);
	mod_assert.func(callback);

	var dirname = mod_path.dirname(oldname);

	mod_assert.strictEqual(dirname, mod_path.dirname(newname));

	mod_fs.rename(oldname, newname, function (err) {
		if (err) {
			callback(new VError(err, 'could not rename "%s" to ' +
			    '"%s"', oldname, newname));
			return;
		}

		sync_directory(dirname, callback);
	});
}

function
write_json_file(path, value, callback)
{
	var cbdone = false;
	var fd;

	var tmpfile = mod_path.join(mod_path.dirname(path),
	    '.' + process.pid + '.' + mod_path.basename(path));

	var out = mod_fs.createWriteStream(tmpfile, {
		flags: 'w',
		encoding: 'utf8',
		mode: MODE_FILE
	});
	out.once('open', function (_fd) {
		fd = _fd;
	});
	out.once('error', function (err) {
		if (cbdone) {
			return;
		}
		cbdone = true;
		out.removeAllListeners();
		callback(err);
	});

	/*
	 * Write the object to disk:
	 */
	out.write(JSON.stringify(value) + '\n', function () {
		mod_assert.notStrictEqual(fd, -1);
		mod_fs.fsync(fd, function (err) {
			if (cbdone) {
				return;
			}

			if (err) {
				cbdone = true;
				out.removeAllListeners();
				callback(err);
				return;
			}

			atomic_rename(tmpfile, path, function (err) {
				if (cbdone)
					return;
				cbdone = true;

				out.removeAllListeners();
				callback(err);
			});
		});
	});
}

function
read_json_file(path, callback)
{
	mod_assert.string(path);
	mod_assert.func(callback);

	var cbdone = false;

	var instr = mod_fs.createReadStream(path, {
		flags: 'r',
		encoding: 'utf8'
	});

	instr.once('error', function (err) {
		if (cbdone) {
			return;
		}
		cbdone = true;
		instr.removeAllListeners();
		callback(err);
	});

	var data = '';
	instr.on('readable', function () {
		for (;;) {
			var buf = instr.read(100);
			if (!buf)
				return;
			data += buf.toString();
		}
	});
	instr.on('end', function () {
		if (cbdone) {
			return;
		}
		var json;
		try {
			json = JSON.parse(data.trim());
		} catch (ex) {
			cbdone = true;
			instr.removeAllListeners();
			callback(ex);
			return;
		}
		cbdone = true;
		instr.removeAllListeners();
		callback(null, json);
	});
}

module.exports = {
	write_json_file: write_json_file,
	read_json_file: read_json_file
};
