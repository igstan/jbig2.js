#!/usr/bin/env node

/**
 * Small utility to generate binary files for testing purposes.
 */

var fs = require("fs");
var buffer = new Buffer([ 0x97, 0x4A, 0x42, 0x32, 0x0D, 0x0A, 0x1A, 0x0A ]);

var file = fs.openSync("corrupt-id.jbig2", "w");
fs.writeSync(file, buffer, 0, buffer.length, 0);
