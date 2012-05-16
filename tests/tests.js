"use strict";

var displaySymbol = function (symbol) {
  var s = "";

  symbol.forEach(function (row) {
    row.forEach(function (value) {
      s += value ? "O" : " ";
    });

    s += "\n";
  });

  return s;
};

var withBuffer = function (file, fn) {
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

var hex = function (n) {
  return (n <= 0xF ? "0" : "") + n.toString(16);
};

var updateViewer = function (buffer) {
  var ul = document.createElement("ul");
  ul.className = "bytes";
  for (var i=0; i<buffer.length; i++) {
    var li = document.createElement("li");
    li.innerHTML = hex(buffer[i]);
    li.className = "byte";
    ul.appendChild(li);
  }

  document.body.appendChild(ul);

  var stream = JBIG2.streamFrom(buffer);
  var viewer = Object.create(stream);
  var pointer = 1;

  viewer.readByte = function () {
    var li = ul.querySelector("li:nth-child("+pointer+")");

    if (li) {
      li.classList.add("read-byte");
    } else {
      console.warn("pointer: ", pointer);
    }

    pointer++;
    var b = stream.readByte.call(this);

    return b;
  };

  return viewer;
};


module("Stream");

test("readBit", function () {
  var stream = JBIG2.streamFrom(new Uint8Array([0xAA]));

  equal(stream.readBit(), 1);
  equal(stream.readBit(), 0);
  equal(stream.readBit(), 1);
  equal(stream.readBit(), 0);
  equal(stream.readBit(), 1);
  equal(stream.readBit(), 0);
  equal(stream.readBit(), 1);
  equal(stream.readBit(), 0);
});

test("readBits", function () {
  var stream = JBIG2.streamFrom(new Uint8Array([0xAA]));
  equal(stream.readBits(4), parseInt("1010", 2));
});

test("readBit + readBits", function () {
  var stream = JBIG2.streamFrom(new Uint8Array([0xE5, 0xCD]));

  // 0xE5
  equal(stream.readBit(), 1);
  equal(stream.readBit(), 1);
  equal(stream.readBit(), 1);
  equal(stream.readBit(), 0);
  equal(stream.readBits(2), parseInt("01", 2));
  equal(stream.readBit(), 0);
  equal(stream.readBit(), 1);

  // 0xCD
  equal(stream.readBit(), 1);
  equal(stream.readBit(), 1);
  equal(stream.readBit(), 0);
  equal(stream.readBit(), 0);
  equal(stream.readBits(2), parseInt("11", 2));
  equal(stream.readBit(), 0);
  equal(stream.readBit(), 1);
});


module("Arithmetic Coding");

test("test decoding of sequence from Annex H, section 2 in the spec", function () {
  var decoded = {
    bytes: [],

    bitIndex: 0,
    byteIndex: 0,

    pushBit: function (bit) {
      var octet = this.bytes[this.byteIndex];
      octet = octet === undefined ? 0x00 : octet;

      octet = octet | (bit << (7 - this.bitIndex));
      this.bytes[this.byteIndex] = octet;

      this.bitIndex++;

      if (this.bitIndex === 8) {
        this.bitIndex = 0;
        this.byteIndex++;
      }
    }
  };

  var sequence = [
    0x00, 0x02, 0x00, 0x51, 0x00, 0x00, 0x00, 0xC0, 0x03, 0x52, 0x87, 0x2A,
    0xAA, 0xAA, 0xAA, 0xAA, 0x82, 0xC0, 0x20, 0x00, 0xFC, 0xD7, 0x9E, 0xF6,
    0xBF, 0x7F, 0xED, 0x90, 0x4F, 0x46, 0xA3, 0xBF
  ];

  var encodedData = JBIG2.streamFrom(new Uint8Array([
    0x84, 0xC7, 0x3B, 0xFC, 0xE1, 0xA1, 0x43, 0x04, 0x02, 0x20, 0x00, 0x00,
    0x41, 0x0D, 0xBB, 0x86, 0xF4, 0x31, 0x7F, 0xFF, 0x88, 0xFF, 0x37, 0x47,
    0x1A, 0xDB, 0x6A, 0xDF, 0xFF, 0xAC
  ]));

  var CX = new ArithmeticContext(512, 0);
  var decode = ArithmeticCoder.decoder(encodedData);
  for (var i=0, max=256; i<max; i++) {
    decoded.pushBit(decode(CX));
  }

  deepEqual(decoded.bytes, sequence);
});

var returnsSequentially = function (values) {
  values = arguments.length === 1 ? values : Array.apply([], arguments);
  return function () {
    return values.shift();
  };
};

// See the IADW decoding example on page 115 of the specification.
test("arithmetic integer decoding", function () {
  var context = new ArithmeticContext(512, 0);
  var stubDecoder = returnsSequentially(0, 1, 0, 1, 0, 0, 0);
  var n = JBIG2.decodeInteger(context, stubDecoder).value;

  equal(n, 12);
});


module("File Header");

asyncTest("throws on invalid file header ID", function () {
  withBuffer("corrupt-id.jbig2", function (buffer) {
    raises(function () {
      JBIG2.parse(buffer);
    }, withMessage("Control header check has failed"));
    start();
  });
});

asyncTest("throws on non-zero reserved bits in file header flags", function () {
  withBuffer("non-zero-reserved-bit.jbig2", function (buffer) {
    raises(function () {
      JBIG2.parse(buffer);
    }, withMessage("Reserved bits (2-7) of file header flags are not zero"));
    start();
  });
});

asyncTest("parses correct file organization", function () {
  withBuffer("annex-h.jbig2", function (buffer) {
    var decoded = JBIG2.parse(buffer);
    equal(decoded.sequential, true);
    equal(decoded.fileOrganization, JBIG2.SEQUENTIAL);
    start();
  });
});

asyncTest("parses correct number of pages", function () {
  withBuffer("annex-h.jbig2", function (buffer) {
    var decoded = JBIG2.parse(buffer);
    equal(decoded.pageCount, 3);
    start();
  });
});


module("Segment Header");

test("spec example 1", function () {
  var buffer = JBIG2.streamFrom(new Uint8Array([
    0x00, 0x00, 0x00, 0x20, // segment number
    0x86,                   // header flags
    0x6B,                   // referred-to segment count and retention flags
    0x02, 0x1E, 0x05,       // referred-to segment numbers
    0x04                    // page association number
  ]));
  var header = JBIG2.parseSegmentHeader(buffer);

  equal(header.number, 32);
  equal(header.flags.segmentType, JBIG2.segmentTypes.IMMEDIATE_TEXT_REGION);
  equal(header.flags.pageAssociationSizeInBytes, 1);
  equal(header.flags.deferredNonRetain, true);
  equal(header.refSegmentCountAndRetentionFlags.refSegmentCount, 3);
  // 1011, i.e. the second referred-to segment need not be retained
  equal(header.refSegmentCountAndRetentionFlags.retentionFlags, 0x0B);
  deepEqual(header.referredSegments, [2, 30, 5]);
  equal(header.pageAssociation, 4);
});

test("spec example 2", function () {
  var buffer = JBIG2.streamFrom(new Uint8Array([
    0x00, 0x00, 0x02, 0x34,             // segment header
    0x40,                               // header flags
    0xE0, 0x00, 0x00, 0x09, 0x02, 0xFD, // referred-to segment count and retention flags
    // referred-to segment numbers, 2 bytes for each numbers because the
    // current segment number is strictly greater than 256
    0x01, 0x00,
    0x00, 0x02,
    0x00, 0x1E,
    0x00, 0x05,
    0x02, 0x00,
    0x02, 0x01,
    0x02, 0x02,
    0x02, 0x03,
    0x02, 0x04,
    // page association number
    0x00, 0x00, 0x04, 0x01
  ]));
  var header = JBIG2.parseSegmentHeader(buffer);

  equal(header.number, 564);
  equal(header.flags.segmentType, JBIG2.segmentTypes.SYMBOL_DICTIONARY);
  equal(header.flags.pageAssociationSizeInBytes, 4);
  equal(header.flags.deferredNonRetain, false);
  equal(header.refSegmentCountAndRetentionFlags.refSegmentCount, 9);
  // 10 1111 1101, i.e. the second referred-to segment need not be retained
  equal(header.refSegmentCountAndRetentionFlags.retentionFlags[0], 0x02);
  equal(header.refSegmentCountAndRetentionFlags.retentionFlags[1], 0xFD);
  deepEqual(header.referredSegments, [256, 2, 30, 5, 512, 513, 514, 515, 516]);
  equal(header.pageAssociation, 1025);
});

test("spec annex H example", function () {
  var buffer = JBIG2.streamFrom(new Uint8Array([
    0x00, 0x00, 0x00, 0x00, // segment number
    0x00,                   // header flags
    0x01,                   // referred-to segment count and retention flags
    0x00,                   // page association size
    0x00, 0x00, 0x00, 0x18  // segment data length
  ]));
  var header = JBIG2.parseSegmentHeader(buffer);

  equal(header.number, 0);
  equal(header.flags.segmentType, JBIG2.segmentTypes.SYMBOL_DICTIONARY);
  equal(header.flags.pageAssociationSizeInBytes, 1);
  equal(header.flags.deferredNonRetain, false);
  equal(header.refSegmentCountAndRetentionFlags.refSegmentCount, 0);
  equal(header.refSegmentCountAndRetentionFlags.retentionFlags, 0x01);
  equal(header.pageAssociation, 0);
  equal(header.dataLength, 24);
});


module("Symbol Dictionary Segment");

test("tenth segment header from Annex H example", function () {
  var buffer = JBIG2.streamFrom(new Uint8Array([
    0x00, 0x00, 0x00, 0x09, 0x00, 0x01, 0x02, 0x00, 0x00, 0x00, 0x1B
  ]));
  var header = JBIG2.parseSegmentHeader(buffer);

  equal(header.number, 9);
  equal(header.flags.segmentType, JBIG2.segmentTypes.SYMBOL_DICTIONARY);
  equal(header.flags.pageAssociationSizeInBytes, 1);
  equal(header.flags.deferredNonRetain, false);
  equal(header.refSegmentCountAndRetentionFlags.refSegmentCount, 0);
  equal(header.refSegmentCountAndRetentionFlags.retentionFlags, 0x01);
  equal(header.pageAssociation, 2);
  equal(header.dataLength, 27);
});

// Tenth segment data from Annex H example.
test("data header of a symbol dictionary segment using Arithmetic encoding", function () {
  var header = JBIG2.parseSegmentHeader(JBIG2.streamFrom(new Uint8Array([
    0x00, 0x00, 0x00, 0x09, 0x00, 0x01, 0x02, 0x00, 0x00, 0x00, 0x1B
  ])));

  var data = JBIG2.streamFrom(new Uint8Array([
    0x08, 0x00, 0x02, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
    0x4F, 0xE7, 0x8C, 0x20, 0x0E, 0x1D, 0xC7, 0xCF, 0x01, 0x11, 0xC4, 0xB2,
    0x6F, 0xFF, 0xAC
  ]));
  var parsedDataHeader = JBIG2.parseSymbolDictionaryDataHeader(header, data);

  equal(parsedDataHeader.encoding, JBIG2.ARITH_ENCODING);
  equal(parsedDataHeader.useHuffman, false);
  equal(parsedDataHeader.useRefAgg, false);
  equal(parsedDataHeader.sdTemplate, 2);
  equal(parsedDataHeader.sdrTemplate, 0);
  equal(parsedDataHeader.usedBitmapCodingContext, 0);
  equal(parsedDataHeader.retainedBitmapCodingContext, 0);
  deepEqual(parsedDataHeader.templatePixels.A, [{x:2, y:-1}]);
  equal(parsedDataHeader.exportedSymbols, 2);
  equal(parsedDataHeader.definedSymbols, 2);
});

// tenth segment data part from Annex H example
test("delta height and width decoded using integer arithmetic decoding", function () {
  var dataPart = JBIG2.streamFrom(new Uint8Array([
    0x4F, 0xE7, 0x8C, 0x20, 0x0E, 0x1D, 0xC7, 0xCF, 0x01, 0x11, 0xC4, 0xB2,
    0x6F, 0xFF, 0xAC
  ]));

  var parsedDataHeader = {
    useHuffman: false,
    useRefAgg: false,
    definedSymbols: 2
  };

  var decode = ArithmeticCoder.decoder(dataPart);

  var deltaHeight = JBIG2.decodeHeightClassDeltaHeight(dataPart, parsedDataHeader, decode);
  equal(deltaHeight.value, 6);
  var deltaWidth = JBIG2.decodeHeightClassDeltaWidth(dataPart, parsedDataHeader, decode);
  equal(deltaWidth.value, 6);
});

test('decodes symbols "a" and "c" from the tenth segment of Annex H example', function () {
  var dataPart = JBIG2.streamFrom(new Uint8Array([
    0x4F, 0xE7, 0x8C, 0x20, 0x0E, 0x1D, 0xC7, 0xCF, 0x01, 0x11, 0xC4, 0xB2,
    0x6F, 0xFF, 0xAC
  ]));

  var symbols = JBIG2.decoders.symbolDictionary(dataPart, {
     useHuffman: false,
     useRefAgg: false,
     inputSymbols: [],
     definedSymbols: 2,
     exportedSymbols: 2,
     huffmanTables: {},
     sdTemplate: 2,
     refinementBitmapTemplate: 0,
     templatePixels: {
       A: [{x:2, y:-1}], // nominal value for GBTEMPLATE 2
       RA: []
     }
  });

  console.group('symbol "c"');
  console.log(displaySymbol(symbols[0]));
  console.groupEnd();
  console.group('symbol "a"');
  console.log(displaySymbol(symbols[1]));
  console.groupEnd();

  equal(symbols.length, 2, "length of exported symbols");

  var _ = 0;

  var c = [
    [_,1,1,1,1,_],
    [1,_,_,_,_,1],
    [1,_,_,_,_,_],
    [1,_,_,_,_,_],
    [1,_,_,_,_,1],
    [_,1,1,1,1,_]
  ];
  deepEqual(symbols[0], c, 'decoded "c" symbol from Figure H.4(a)');

  var a = [
    [_,1,1,1,1,_],
    [_,_,_,_,_,1],
    [_,1,1,1,1,1],
    [1,_,_,_,_,1],
    [1,_,_,_,_,1],
    [_,1,1,1,1,1]
  ];
  deepEqual(symbols[1], a, 'decoded "a" symbol from Figure H.4(b)');
});

test("seventeenth segment in Annex H", function () {
  var _ = 0;
  var data = JBIG2.streamFrom(new Uint8Array([
    0x4F, 0xE7, 0x8D, 0x68, 0x1B, 0x14, 0x2F, 0x3F, 0xFF, 0xAC
  ]));

  var symbols = JBIG2.decoders.symbolDictionary(data, {
     useHuffman: false,
     useRefAgg: false,
     inputSymbols: [],
     definedSymbols: 1,
     exportedSymbols: 1,
     huffmanTables: {},
     sdTemplate: 2,
     refinementBitmapTemplate: 0,
     templatePixels: {
       A: [{x: 2, y:-1}], // nominal value for GBTEMPLATE 2
       RA: []
     }
  });

  // See Figure H.12(a)
  deepEqual(symbols[0], [
    [_,1,1,1,1,_],
    [_,_,_,_,_,1],
    [_,1,1,1,1,1],
    [1,_,_,_,_,1],
    [1,_,_,_,_,1],
    [_,1,1,1,1,1]
  ]);
});

// Third segment in the Annex H example.
test("data header of a symbol dictionary segment using Huffman encoding", function () {
  var header = JBIG2.parseSegmentHeader(JBIG2.streamFrom(new Uint8Array([
    0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x1C
  ])));
  var data = JBIG2.streamFrom(new Uint8Array([
    0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0xE5, 0xCD,
    0xF8, 0x00, 0x79, 0xE0, 0x84, 0x10, 0x81, 0xF0, 0x82, 0x10, 0x86, 0x10,
    0x79, 0xF0, 0x00, 0x80
  ]));

  var parsedDataHeader = JBIG2.parseSymbolDictionaryDataHeader(header, data);

  equal(parsedDataHeader.encoding, JBIG2.HUFFMAN_ENCODING);
  equal(parsedDataHeader.useHuffman, true);
  equal(parsedDataHeader.useRefAgg, false);
  equal(parsedDataHeader.huffmanTables.deltaWidth, "B2");
  equal(parsedDataHeader.huffmanTables.deltaHeight, "B4");
  equal(parsedDataHeader.huffmanTables.heightClassCollective, "B1");
  equal(parsedDataHeader.huffmanTables.aggregationSymbolInstanceCount, "B1");
  equal(parsedDataHeader.exportedSymbols, 2);
  equal(parsedDataHeader.definedSymbols, 2);
});

// Third segment in the Annex H example.
test("delta height and width decoded using Huffman encoding", function () {
  var dataPart = JBIG2.streamFrom(new Uint8Array([
    0xE5, 0xCD, 0xF8, 0x00, 0x79, 0xE0, 0x84, 0x10, 0x81, 0xF0, 0x82, 0x10,
    0x86, 0x10, 0x79, 0xF0, 0x00, 0x80
  ]));

  var parsedDataHeader = {
     useHuffman: true,
     useRefAgg: false,
     inputSymbols: [],
     definedSymbols: 2,
     exportedSymbols: 2,
     huffmanTables: {
       deltaWidth: "B2",
       deltaHeight: "B4",
       heightClassCollective: "B1",
       aggregationSymbolInstanceCount: "B1"
     }
  };

  var decode = null; // arithmetic decoder not used here

  var deltaHeight = JBIG2.decodeHeightClassDeltaHeight(dataPart, parsedDataHeader, decode);
  equal(deltaHeight.value, 6);
  var deltaWidth = JBIG2.decodeHeightClassDeltaWidth(dataPart, parsedDataHeader, decode);
  equal(deltaWidth.value, 6);
  var deltaWidth = JBIG2.decodeHeightClassDeltaWidth(dataPart, parsedDataHeader, decode);
  equal(deltaWidth.value, 0);
  var deltaWidth = JBIG2.decodeHeightClassDeltaWidth(dataPart, parsedDataHeader, decode);
  equal(deltaWidth.isOOB, true);
});

// Third segment in the Annex H example.
test("data part of a symbol dictionary segment using Huffman encoding", function () {
  var encoded = JBIG2.streamFrom(new Uint8Array([
    0xE5, 0xCD, 0xF8, 0x00, 0x79, 0xE0, 0x84, 0x10, 0x81, 0xF0, 0x82, 0x10,
    0x86, 0x10, 0x79, 0xF0, 0x00, 0x80
  ]));

  var symbols = JBIG2.decoders.symbolDictionary(encoded, {
     useHuffman: true,
     useRefAgg: false,
     inputSymbols: [],
     definedSymbols: 2,
     exportedSymbols: 2,
     huffmanTables: {
       deltaWidth: "B2",
       deltaHeight: "B4",
       heightClassCollective: "B1",
       aggregationSymbolInstanceCount: "B1"
     }
  });

  console.group('symbol "c"');
  console.log(displaySymbol(symbols[0]));
  console.groupEnd();
  console.group('symbol "a"');
  console.log(displaySymbol(symbols[1]));
  console.groupEnd();

  equal(symbols.length, 2, "length of exported symbols");

  var _ = 0;

  var c = [
    [_,1,1,1,1,_],
    [1,_,_,_,_,1],
    [1,_,_,_,_,_],
    [1,_,_,_,_,_],
    [1,_,_,_,_,1],
    [_,1,1,1,1,_]
  ];
  deepEqual(symbols[0], c, 'decoded "c" symbol from Figure H.4(a)');

  var a = [
    [_,1,1,1,1,_],
    [_,_,_,_,_,1],
    [_,1,1,1,1,1],
    [1,_,_,_,_,1],
    [1,_,_,_,_,1],
    [_,1,1,1,1,1]
  ];
  deepEqual(symbols[1], a, 'decoded "a" symbol from Figure H.4(b)');
});


module("Generic Region Segment");

// See the twelfth segment data part in Annex H.
test("parse generic region segment data header", function () {
  var data = JBIG2.streamFrom(new Uint8Array([
    0x00, 0x00, 0x00, 0x36, 0x00, 0x00, 0x00, 0x2C, 0x00, 0x00, 0x00, 0x04,
    0x00, 0x00, 0x00, 0x0B, 0x00, 0x08, 0x03, 0xFF, 0xFD, 0xFF, 0x02, 0xFE,
    0xFE, 0xFE, 0x04, 0xEE, 0xED, 0x87, 0xFB, 0xCB, 0x2B, 0xFF, 0xAC
  ]));

  var segmentHeader = {};

  var parsed = JBIG2.parseGenericRegionSegmentDataHeader(segmentHeader, data);

  equal(parsed.width, 54);
  equal(parsed.height, 44);
  equal(parsed.offset.x, 4);
  equal(parsed.offset.y, 11);
  equal(parsed.operation, "OR");
  equal(parsed.useMMR, false);
  equal(parsed.templateID, 0);
  equal(parsed.useTypicalPrediction, true);
  deepEqual(parsed.templatePixels, [
    {x:3, y:-1}, {x:-3, y:-1}, {x:2, y:-2}, {x:-2, y:-2}
  ]);

  var ctx = new ArithmeticContext(65536, 0);
  var decode = ArithmeticCoder.decoder(data);

  var bitmap = JBIG2.decodeGenericRegion(data, {
    useMMR: parsed.useMMR,
    width: parsed.width,
    height: parsed.height,
    templateID: parsed.templateID,
    useTypicalPrediction: parsed.useTypicalPrediction,
    skipPixels: [],
    templatePixels: parsed.templatePixels
  }, decode, ctx);

  var _ = 0;
  // See Figure H.6.
  var expectedBitmap = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
  ];

  deepEqual(bitmap, expectedBitmap);
});

test("extract number from bitmap using GBTEMPLATE 0 (simple)", function () {
  var currentPixel = {x:1, y:0};
  var adaptivePixels = [{x: 3, y:-1}, {x:-3, y:-1}, {x: 2, y:-2}, {x:-2, y:-2}];
  var bitmap = [[1]];

  var n = JBIG2.GBTEMPLATE[0](currentPixel, adaptivePixels, bitmap);
  equal(n, 1);
});

test("extract number from bitmap using GBTEMPLATE 0 (complex)", function () {
  var currentPixel = {x:2, y:2};
  var adaptivePixels = [{x:3, y:-1}, {x:-3, y:-1}, {x:2, y:-2}, {x:-2, y:-2}];
  var bitmap = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1, 0, 1],
    [1, 1]
  ];

  var n = JBIG2.GBTEMPLATE[0](currentPixel, adaptivePixels, bitmap);
  equal(n, 64163);
});

test("extract number from bitmap using GBTEMPLATE 0 and custom A4 pixel coordinates", function () {
  var currentPixel = {x:2, y:2};

  // The last AT pixel, A4 is placed at [-1,-1] instead of [-2,-2]
  var adaptivePixels = [{x: 3, y:-1}, {x:-3, y:-1}, {x: 2, y:-2}, {x:-1, y:-1}];
  var bitmap = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1, 0, 1],
    [1, 1]
  ];

  var n = JBIG2.GBTEMPLATE[0](currentPixel, adaptivePixels, bitmap);
  equal(n, 31395);
});

test("extract number from bitmap using GBTEMPLATE 1 (simple)", function () {
  var currentPixel = {x:1, y:0};
  var adaptivePixels = [{x:3, y:-1}];
  var bitmap = [[1]];

  var n = JBIG2.GBTEMPLATE[1](currentPixel, adaptivePixels, bitmap);
  equal(n, 1);
});

test("extract number from bitmap using GBTEMPLATE 1 (complex)", function () {
  var currentPixel = {x:2, y:2};
  var adaptivePixels = [{x:3, y:-1}];
  var bitmap = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1, 0, 1],
    [1, 1]
  ];

  var n = JBIG2.GBTEMPLATE[1](currentPixel, adaptivePixels, bitmap);
  equal(n, 8019);
});

test("extract number from bitmap using GBTEMPLATE 2 (simple)", function () {
  var currentPixel = {x:1, y:0};
  var adaptivePixels = [{x: 2, y:-1}];
  var bitmap = [[1]];

  var n = JBIG2.GBTEMPLATE[2](currentPixel, adaptivePixels, bitmap);
  equal(n, 1);
});

test("extract number from bitmap using GBTEMPLATE 2 (complex)", function () {
  var currentPixel = {x:2, y:2};
  var adaptivePixels = [{x:2, y:-1}];
  var bitmap = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1, 0, 1],
    [1, 1]
  ];

  var n = JBIG2.GBTEMPLATE[2](currentPixel, adaptivePixels, bitmap);
  equal(n, 983);
});

test("extract number from bitmap using GBTEMPLATE 3 (simple)", function () {
  var currentPixel = {x:1, y:0};
  var adaptivePixels = [{x:2, y:-1}];
  var bitmap = [[1]];

  var n = JBIG2.GBTEMPLATE[3](currentPixel, adaptivePixels, bitmap);
  equal(n, 1);
});

test("extract number from bitmap using GBTEMPLATE 3 (complex)", function () {
  var currentPixel = {x:2, y:2};
  var adaptivePixels = [{x:2, y:-1}];
  var bitmap = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1, 0, 1],
    [1, 1]
  ];

  var n = JBIG2.GBTEMPLATE[3](currentPixel, adaptivePixels, bitmap);
  equal(n, 339);
});
