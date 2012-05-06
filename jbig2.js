;(function (global) {
  "use strict";

  var SEQUENTIAL       = "SEQUENTIAL";
  var RANDOM_ACCESS    = "RANDOM_ACCESS";
  var ARITH_ENCODING   = "ARITH_ENCODING";
  var HUFFMAN_ENCODING = "HUFFMAN_ENCODING";
  var OOB              = { toString: function () { return "out-of-band"; } };

  var controlHeader = [0x97, 0x4A, 0x42, 0x32, 0x0D, 0x0A, 0x1A, 0x0A];

  var int32 = function (number) {
    return (number[0] << 24) | (number[1] << 16) | (number[2] << 8) | number[3];
  };

  var int16 = function (number) {
    return (number[0] << 8) | number[1];
  };

  var parseHeaderFlags = function (octet, decoded) {
    if ((octet & 0xfc) != 0) {
      throw new Error("Reserved bits (2-7) of file header flags are not zero");
    }

    decoded.sequential       = (octet & 1) === 1;
    decoded.fileOrganization = (octet & 1) === 1 ? SEQUENTIAL : RANDOM_ACCESS;
    decoded.knownPageCount   = (octet & 2) === 0;

    return decoded;
  };

  var decodeHeader = function (decoded, buffer) {
    controlHeader.forEach(function (n, i) {
      if (buffer.readByte() !== n) {
        throw new Error("Control header check has failed");
      }
    });

    var headerFlags = buffer.readByte();
    decoded = parseHeaderFlags(headerFlags, decoded);

    if (decoded.knownPageCount) {
      decoded.pageCount = buffer.readInt32();
    }

    return decoded;
  };

  var segmentTypes = {
    SYMBOL_DICTIONARY                            : 0,
    INTERMEDIATE_TEXT_REGION                     : 4,
    IMMEDIATE_TEXT_REGION                        : 6,
    IMMEDIATE_LOSSLESS_TEXT_REGION               : 7,
    PATTERN_DICTIONARY                           : 16,
    INTERMEDIATE_HALFTONE_REGION                 : 20,
    IMMEDIATE_HALFTONE_REGION                    : 22,
    IMMEDIATE_LOSSLESS_HALFTONE_REGION           : 23,
    INTERMEDIATE_GENERIC_REGION                  : 36,
    IMMEDIATE_GENERIC_REGION                     : 38,
    IMMEDIATE_LOSSLESS_GENERIC_REGION            : 39,
    INTERMEDIATE_GENERIC_REFINEMENT_REGION       : 40,
    IMMEDIATE_GENERIC_REFINEMENT_REGION          : 42,
    IMMEDIATE_LOSSLESS_GENERIC_REFINEMENT_REGION : 43,
    PAGE_INFORMATION                             : 48,
    END_OF_PAGE                                  : 49,
    END_OF_STRIPE                                : 50,
    END_OF_FILE                                  : 51,
    PROFILES                                     : 52,
    TABLES                                       : 53,
    EXTENSION                                    : 62
  };

  // INTDECODE. See Figure A.1 in the specification.
  var decodeInteger = function (CX, arithmeticDecode) {
    var bitsToRead, padding;
    var V = 0;

    // PREV always contains the values of the eight most-recently-decoded
    // bits, plus a leading 1 bit, which is used to indicate the number of
    // bits decoded so far.
    var PREV = 1;

    // This function takes care that the latest decoded bit is pushed into PREV.
    var decodeBit = function () {
      CX.index = PREV; // update the context before decoding the next bit
      var D = arithmeticDecode(CX);

      if (PREV < 256) {
        PREV = (PREV << 1) | D;
      } else {
        PREV = (((PREV << 1) | D) & 511) | 256;
      }

      return D;
    };

    var S = decodeBit();

    if (decodeBit()) {
      if (decodeBit()) {
        if (decodeBit()) {
          if (decodeBit()) {
            if (decodeBit()) {
              bitsToRead = 32;
              padding = 4436;
            } else {
              bitsToRead = 12;
              padding = 340;
            }
          } else {
            bitsToRead = 8;
            padding = 84;
          }
        } else {
          bitsToRead = 6;
          padding = 20;
        }
      } else {
        bitsToRead = 4;
        padding = 4;
      }
    } else {
      bitsToRead = 2;
      padding = 0;
    }

    while (bitsToRead--) {
      var D = decodeBit();
      V = (V << 1) | D;
    }

    V += padding;

    return S === 0 ? V : (V > 0 ? -V : OOB);
  };

  var decodingContexts = {
    IAAI : new ArithmeticContext(512, 0),
    IADH : new ArithmeticContext(512, 0),
    IADS : new ArithmeticContext(512, 0),
    IADT : new ArithmeticContext(512, 0),
    IADW : new ArithmeticContext(512, 0),
    IAEX : new ArithmeticContext(512, 0),
    IAFS : new ArithmeticContext(512, 0),
    IAIT : new ArithmeticContext(512, 0),
    IARI : new ArithmeticContext(512, 0),
    IARDH: new ArithmeticContext(512, 0),
    IARDW: new ArithmeticContext(512, 0),
    IARDX: new ArithmeticContext(512, 0),
    IARDY: new ArithmeticContext(512, 0),
  };

  var decodeHeightClassDeltaHeight = function (args, decode) {
    if (args.useHuffman) {
      decodeUsing(args.huffmanTables.deltaHeight);
    } else {
      return decodeInteger(decodingContexts.IADH, decode);
    }
  };

  var decodeHeightClassDeltaWidth = function (args, decode) {
    if (args.useHuffman) {
      decodeUsing(args.huffmanTables.deltaWidth);
    } else {
      return decodeInteger(decodingContexts.IADW, decode);
    }
  };

  var decoders = {
    // Params:
    //
    //  - `useHuffman`: boolean, use Huffman coding
    //  - `useRefAgg`: boolean, use refinement and aggregate coding
    //  - `inputSymbolCount`: number
    //  - `inputSymbols`: array of symbols
    //  - `defineSymbolCount`: number
    //  - `exportSymbolCount`: number
    //  - `huffmanTables`: { deltaWidth, deltaHeight, heightClass, aggregationInstances }
    //  - `symbolBitmapTemplate`: number
    //  - `refinementBitmapTemplate`: number
    //  - `templatePixels`: { A[4]: [{x, y}], RA[2]: [{x, y}]}
    //
    // Returns: an array of symbols
    //
    symbolDictionary: function (buffer, args) {
      var definedSymbols = [];

      if (args.useHuffman && !args.useRefAgg) {
        var definedSymbolWidths = []; // has args.defineSymbolCount length
      }

      var currentHeightClass = 0;
      var currentSymbolWidth = 0;
      var currentHeightClassWidth = 0;

      for (var decodedSymbols = 0; decodedSymbols < args.defineSymbolCount; decodedSymbols++) {
        var deltaHeight = decodeHeightClassDeltaHeight(buffer, args);
        currentHeightClass = currentHeightClass + deltaHeight;
        currentSymbolWidth = 0;
        currentHeightClassWidth = 0;
        var firstSymbolInCurrentHeightClass = decodedSymbols;
      }
    }
  };

  var decodeSegmentHeaderFlags = function (flags) {
    return {
      deferredNonRetain:          (flags & 0x80) === 0x80,          // 1000 0000
      pageAssociationSizeInBytes: (flags & 0x40) ? 4 : 1,           // 0100 0000
      segmentType:                (flags & 0x3F)                    // 0011 1111
    };
  };

  var decodeRefSegmentCountAndRetentionFlags = function (buffer) {
    var decoded = {};
    var octet = buffer.readByte();
    var refSegmentCount = (octet & 0xE0) >> 5;

    if (refSegmentCount <= 4) {
      decoded.refSegmentCount = refSegmentCount;
      decoded.retentionFlags = (octet & ~0xe0); // clear the first 3 bits (5-7), i.e. we drop the refSegmentCount
    } else if (refSegmentCount === 7) {
      var longFormCountAndFlags = new Uint8Array([
        (octet & ~0xe0), // clear the first 3 bits (5-7), i.e. we drop the refSegmentCount
        buffer.readByte(),
        buffer.readByte(),
        buffer.readByte()
      ]);

      refSegmentCount = int32(longFormCountAndFlags);

      // see section 7.2.4 of the specs
      var bytesToRead = 4 + Math.ceil((refSegmentCount + 1) / 8);
      var noOfRententionFlagBytes = bytesToRead - 4;
      decoded.retentionFlags = buffer.readBytes(noOfRententionFlagBytes);
      decoded.refSegmentCount = refSegmentCount;

    } else {
      throw new Error(
        'Invalid value for the "count of referred-to segments" in the ' +
        '3-bit subfield. It must be either 4 or 7, but got: ' + refSegmentCount
      );
    }

    return decoded;
  };

  // A segment has two parts: a segment header part and a segment data part.
  //
  // A segment header contains the following fields:
  //  - segment number
  //  - segment header flags
  //  - referred-to segment count and retention flags
  //  - referred-to segment numbers
  //  - segment page association
  //  - segment data length
  //
  var parseSegmentHeader = function (buffer) {
    var segment = {};

    segment.number = buffer.readInt32();
    segment.flags  = decodeSegmentHeaderFlags(buffer.readByte());
    segment.refSegmentCountAndRetentionFlags = decodeRefSegmentCountAndRetentionFlags(buffer);

    segment.referredSegments = [];
    var segmentCount = segment.refSegmentCountAndRetentionFlags.refSegmentCount;

    if (segment.number <= 256) {
      var bytes = buffer.readBytes(segmentCount);
      for (var i=0; i<bytes.length; i += 1) {
        segment.referredSegments.push(bytes[i]);
      }
    } else if (segment.number <= 65536) {
      var bytes = buffer.readBytes(segmentCount * 2);
      for (var i=0; i<bytes.length; i += 2) {
        segment.referredSegments.push(int16(bytes.subarray(i, i + 2)));
      }
    } else {
      var bytes = buffer.readBytes(segmentCount * 4);
      for (var i=0; i<bytes.length; i += 4) {
        segment.referredSegments.push(int32(bytes.subarray(i, i + 4)));
      }
    }

    segment.pageAssociation = segment.flags.pageAssociationSizeInBytes === 1
                            ? buffer.readByte()
                            : buffer.readInt32();
    segment.dataLength = buffer.readInt32();

    return segment;
  };

  var streamFrom = function (buffer) {
    var pointer = 0;

    return {
      readByte: function () {
        return buffer[pointer++];
      },

      readBytes: function (n) {
        var bytes = buffer.subarray(pointer, pointer + n);
        pointer += n;
        return bytes;
      },

      readInt32: function () {
        return int32(this.readBytes(4));
      },

      readSignedByte: function () {
        var octet = this.readByte();
        return (octet & 0x80) === 0x00 ? octet : octet | -0x0100;
      }
    };
  };

  var parseSymboldDictionaryFlags = function (dataHeader, buffer) {
    var leftByte = buffer.readByte();
    var rightByte = buffer.readByte();

    dataHeader.encoding = (rightByte & 0x01) ? HUFFMAN_ENCODING : ARITH_ENCODING;
    dataHeader.useRefinementAggregateCoding = (rightByte & 0x02) === 0x02;

    // This should only be parsed when dataHeader.encoding = HUFFMAN_ENCODING.
    var deltaHeight = (rightByte & 0x0C) >> 2;
    var deltaHeightTable;
    switch (deltaHeight) {
      case 0: deltaHeightTable = "B.4"; break;
      case 1: deltaHeightTable = "B.5"; break;
      case 2: throw new Error("Illegal value");
      case 3: deltaHeightTable = "USER_DEFINED"; break;
    }

    // This should only be parsed when dataHeader.encoding = HUFFMAN_ENCODING.
    var deltaWidth = (rightByte & 0x30) >> 4;
    var deltaWidthTable;
    switch (deltaWidth) {
      case 0: deltaWidthTable = "B.2"; break;
      case 1: deltaWidthTable = "B.3"; break;
      case 2: throw new Error("Illegal value");
      case 3: deltaWidthTable = "USER_DEFINED"; break;
    }

    var heightClassCollective = ((rightByte & 0x30) >> 6) === 0x00 ? "B.1" : "USER_DEFINED";
    var aggregationSymbolInstanceCount = ((rightByte & 0x40) >> 7) === 0x00 ? "B.1" : "USER_DEFINED";

    dataHeader.huffmanTables = {
      deltaHeight: deltaHeightTable,
      deltaWidth: deltaWidthTable,
      heightClassCollective: heightClassCollective,
      aggregationSymbolInstanceCount: aggregationSymbolInstanceCount
    };

    dataHeader.sdTemplate = (leftByte & 0x0C) >> 2;
    dataHeader.sdrTemplate = (leftByte & 0x10) >> 4;
    dataHeader.usedBitmapCodingContext = (leftByte & 0x01) === 0x01;
    dataHeader.retainedBitmapCodingContext = (leftByte & 0x02) === 0x02;
  };

  var parseSymboldDictionaryATFlags = function (dataHeader, buffer) {
    if (dataHeader.sdTemplate === 0) {
      dataHeader.templatePixels.A = [
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() },
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() },
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() },
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() }
      ];
    } else {
      dataHeader.templatePixels.A = [
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() }
      ];
    }
  };

  var parseSymbolDictionaryRefinementATFlags = function (dataHeader, buffer) {
    if (dataHeader.useRefinementAggregateCoding && dataHeader.sdrTemplate === 0) {
      dataHeader.templatePixels.AR = [
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() },
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() }
      ];
    }
  };

  var parseSymbolDictionaryDataHeader = function (segmentHeader, buffer) {
    var parsedDataHeader = {
      templatePixels: {
        A: [], AR: []
      }
    };

    parseSymboldDictionaryFlags(parsedDataHeader, buffer);
    parseSymboldDictionaryATFlags(parsedDataHeader, buffer);
    parseSymbolDictionaryRefinementATFlags(parsedDataHeader, buffer);

    parsedDataHeader.exportedSymbols = buffer.readInt32();
    parsedDataHeader.definedSymbols = buffer.readInt32();

    return parsedDataHeader;
  };

  var parseOperation = function (buffer) {
    var octet = buffer.readByte();

    if ((octet & 0xF8) !== 0) throw new Error("First 5 bits must be all 0");

    var last3Bits = octet & 0x07;

    switch (last3Bits) {
      case 0: return "OR";
      case 1: return "AND";
      case 2: return "XOR";
      case 3: return "XNOR";
      case 4: return "REPLACE";
    }
  };

  var parseGenericRegionSegmentFlags = function (buffer, parsed) {
    var octet = buffer.readByte();

    if ((octet & 0xF0) !== 0) throw new Error("First 4 bits must be all 0");

    parsed.useMMR = !!(octet & 0x01);
    parsed.templateID = (octet & 0x06) >> 1;
    parsed.useTypicalPrediction = !!(octet & 0x08);
  };

  var parseTemplatePixels = function (buffer, parsed) {
    if (parsed.useMMR) {
      return { A: [] };
    }

    if (parsed.templateID === 0) {
      parsed.templatePixels = [
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() },
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() },
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() },
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() }
      ];
    } else {
      parsed.templatePixels = [
        { x: buffer.readSignedByte(), y: buffer.readSignedByte() },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 }
      ];
    }
  };

  var parseGenericRegionSegmentDataHeader = function (header, buffer) {
    var parsed = {
      width:  buffer.readInt32(),
      height: buffer.readInt32(),
      offset: {
        x: buffer.readInt32(),
        y: buffer.readInt32()
      },
      operation: parseOperation(buffer),
    };

    parseGenericRegionSegmentFlags(buffer, parsed);
    parseTemplatePixels(buffer, parsed);

    return parsed;
  };

  global.JBIG2 = {
    SEQUENTIAL: SEQUENTIAL,
    RANDOM_ACCESS: RANDOM_ACCESS,
    ARITH_ENCODING: ARITH_ENCODING,
    HUFFMAN_ENCODING: HUFFMAN_ENCODING,

    streamFrom: streamFrom,
    parseSegmentHeader: parseSegmentHeader,
    segmentTypes: segmentTypes,

    parseSymbolDictionaryDataHeader: parseSymbolDictionaryDataHeader,

    decodeInteger: decodeInteger,

    parseGenericRegionSegmentDataHeader: parseGenericRegionSegmentDataHeader,

    decodeHeightClassDeltaHeight: decodeHeightClassDeltaHeight,
    decodeHeightClassDeltaWidth: decodeHeightClassDeltaWidth,

    parse: function (buffer) {
      var stream  = streamFrom(buffer);
      var decoded = {};

      decodeHeader(decoded, stream);
      parseSegmentHeader(stream);

      return decoded;
    }
  };

})(this);

// typical segments in a file
// var segments = [
//   // page info
//   // symbol dictionary segment
//   // text region segment
//   // pattern dictionary segment
//   // halftone region segment
//   // end-of-page segment
// ];

// segments are numbered sequentially and may contain references
// to previous segments
//
// there are **region** and **dictionary** segments
// var segment = {
//   segmentHeader: null,
//   dataHeader: null,
//   data: null
// };


// A JBIG2 file may be organized in two ways:
//    - sequential
//    - random access


// Entities in the decoding process
//
// +--------------+--------------------------+-------------------------+---------------------------+
// |  Concept     | JBIG2 bitstream entity   |  JBIG2 decoding entity  |  Physical representation  |
// |              |                          |                         |                           |
// +--------------+--------------------------+-------------------------+---------------------------+
// |  Document    | JBIG2 file               |  JBIG2 decoder          |  Output medium or device  |
// +--------------+--------------------------+-------------------------+---------------------------+
// |  Page        | Collection of segments   |  Implicit in control    |  Page buffer              |
// |              |                          |    decoding procedure   |                           |
// +--------------+--------------------------+-------------------------+---------------------------+
// |  Region      | Region segment           |  Region decoding        |  Page buffer or auxiliary |
// |              |                          |    procedure            |    buffer                 |
// +--------------+--------------------------+-------------------------+---------------------------+
// |  Dictionary  | Dictionary segment       |  Dictionary decoding    |  List of symbols          |
// |              |                          |    procedure            |                           |
// +--------------+--------------------------+-------------------------+---------------------------+
// |  Character   | Field within a symbol    |  Symbol dictionary      |  Symbol bitmap            |
// |              |   dictionary segment     |    decoding procedure   |                           |
// +--------------+--------------------------+-------------------------+---------------------------+
// |  Gray-scale  | Field within a halftone  |  Pattern dictionary     |  Pattern                  |
// |  value       |   dictionary segment     |    decoding procedure   |                           |
// +--------------+--------------------------+-------------------------+---------------------------+



// Decoding Procedures
// ===================


// 6.2 – Generic Region Decoding Procedure

// 6.3 – Generic Refinement Region Decoding Procedure

// 6.4 – Text Region Decoding Procedure

// 6.5 – Symbol Dictionary Decoding Procedure

// 6.6 – Halftone Region Decoding Procedure

// 6.7 – Pattern Dictionary Decoding Procedure

// 7 – Control Decoding Procedure
//     Controls all the previous decoding procedures.

// 7.2 – Segment header syntax
