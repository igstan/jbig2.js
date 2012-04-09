"use strict";

var loadBuffer = function (fn) {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "annex-h.jbig2");
  xhr.responseType = "arraybuffer";
  xhr.onload = function (event) {
    var buffer = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
    fn(buffer);
  };
  xhr.send();
};

asyncTest("parses correct number of pages", function () {
  loadBuffer(function (buffer) {
    var decoded = JBIG2.parse(buffer);
    equal(decoded.pageCount, 3);
    start();    
  });
});
