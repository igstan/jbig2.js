"use strict";

var loadBuffer = function (file, fn) {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", file);
  xhr.responseType = "arraybuffer";
  xhr.onload = function (event) {
    var buffer = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
    fn(buffer);
  };
  xhr.send();
};

var withMessage = function (message) {
  return function (error) {
    return error.message === message;
  };
};

asyncTest("throws on invalid file header ID", function () {
  loadBuffer("corrupt-id.jbig2", function (buffer) {
    raises(function () {
      JBIG2.parse(buffer);
    }, withMessage("Control header check has failed"));
    start();
  });
});

asyncTest("throws on non-zero reserved bits in file header flags", function () {
  loadBuffer("non-zero-reserved-bit.jbig2", function (buffer) {
    raises(function () {
      JBIG2.parse(buffer);
    }, withMessage("Reserved bits (2-7) of file header flags are not zero"));
    start();
  });
});

asyncTest("parses correct file organization", function () {
  loadBuffer("annex-h.jbig2", function (buffer) {
    var decoded = JBIG2.parse(buffer);
    equal(decoded.sequential, true);
    equal(decoded.fileOrganization, JBIG2.SEQUENTIAL);
    start();
  });
});

asyncTest("parses correct number of pages", function () {
  loadBuffer("annex-h.jbig2", function (buffer) {
    var decoded = JBIG2.parse(buffer);
    equal(decoded.pageCount, 3);
    start();
  });
});

test("segment header parsing", function () {
  var buffer = JBIG2.streamFrom(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x18]));
  var header = JBIG2.parseSegmentHeader(buffer);

  console.log(header);

  equal(header.number, 0);
  equal(header.flags.segmentType, JBIG2.segmentTypes.SYMBOL_DICTIONARY);
  equal(header.flags.pageAssociationSizeInBytes, 1);
});
