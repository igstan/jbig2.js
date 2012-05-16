;(function (global) {
  "use strict";

  var SEQUENTIAL       = "SEQUENTIAL";
  var RANDOM_ACCESS    = "RANDOM_ACCESS";
  var ARITH_ENCODING   = "ARITH_ENCODING";
  var HUFFMAN_ENCODING = "HUFFMAN_ENCODING";

  var OOB = {
    isOOB: true,
    toString: function () {
      return "out-of-band";
    }
  };

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

  var arithValue = function (v) {
    return {
      isOOB: false,
      value: v
    };
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

    return S === 0 ? arithValue(V) : (V > 0 ? arithValue(-V) : OOB);
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

  var decodeHeightClassDeltaHeight = function (buffer, args, decode) {
    if (args.useHuffman) {
      return huffman.decode(buffer, huffman.STANDARD_TABLES[args.huffmanTables.deltaHeight]);
    } else {
      return decodeInteger(decodingContexts.IADH, decode);
    }
  };

  var decodeHeightClassDeltaWidth = function (buffer, args, decode) {
    if (args.useHuffman) {
      return huffman.decode(buffer, huffman.STANDARD_TABLES[args.huffmanTables.deltaWidth]);
    } else {
      return decodeInteger(decodingContexts.IADW, decode);
    }
  };

  var superimposeTemplate = function (currentPixel, template, bitmap) {
    var x = currentPixel.x;
    var y = currentPixel.y;
    var width = bitmap[0].length;
    var height = bitmap.length;
    var n = 0;

    for (var i=0, imax=template.length; i<imax; i++) {
      var row = template[i];

      for (var j=row.x.min, jmax=row.x.max; j<=jmax; j++) {
        var targetX = x + j;
        var targetY = y + row.y;

        // Skip if pixel coordinates are not on the bitmap.
        if (targetX < 0 || targetX >= width) {
          n = (n << 1);
          continue;
        }
        if (targetY < 0 || targetY >= height) {
          n = (n << 1);
          continue;
        }

        n = (n << 1) | bitmap[targetY][targetX];
      }
    }

    return n;
  };

  var GBTEMPLATE = [
    // GBTEMPLATE=0. (section 6.2.5.3, figure 3)
    //
    // Given the location of the pixel currently being decoded, the location
    // of the adaptive template pixels, and a bitmap with the already decoded
    // bits, it will return the new context value to be used in arithmetic
    // decoding.
    //
    function (currentPixel, AT, bitmap) {
      // _ _ 4 X X X 3 _
      // _ 2 X X X X X 1
      // X X X X o _ _ _
      var template = [
        {y:-2, x:{min:-2, max: 2}},
        {y:-1, x:{min:-3, max: 3}},
        {y: 0, x:{min:-4, max:-1}},
      ];

      // If the locations of the adaptive template pixels are not the default
      // one, then we adjust the limit intervals of the X coordinates in the
      // template. Basically, we remove them. This is because an AT pixel is
      // ignored if it's found positioned above a normal pixel.
      if (AT[3].x !== template[0].x.min || AT[3].y !== template[0].y)
        template[0].x.min = -1;
      if (AT[2].x !== template[0].x.max || AT[2].y !== template[0].y)
        template[0].x.max = 1;
      if (AT[1].x !== template[1].x.min || AT[1].y !== template[1].y)
        template[1].x.min = -2;
      if (AT[0].x !== template[1].x.max || AT[0].y !== template[1].y)
        template[1].x.max = 2;

      return superimposeTemplate(currentPixel, template, bitmap);
    },

    // GBTEMPLATE=1. (section 6.2.5.3, figure 4)
    //
    // Given the location of the pixel currently being decoded, the location
    // of the adaptive template pixels, and a bitmap with the already decoded
    // bits, it will return the new context value to be used in arithmetic
    // decoding.
    //
    function (currentPixel, AT, bitmap) {
      // _ _ X X X X
      // _ X X X X X 1
      // X X X o _ _
      var template = [
        {y:-2, x:{min:-1, max: 2}},
        {y:-1, x:{min:-2, max: 3}},
        {y: 0, x:{min:-3, max:-1}},
      ];

      // If the locations of the adaptive template pixels are not the default
      // one, then we adjust the limit intervals of the X coordinates in the
      // template. Basically, we remove them. This is because an AT pixel is
      // ignored if it's found positioned above a normal pixel.
      if (AT[0].x !== template[1].x.max || AT[0].y !== template[1].y)
        template[1].x.max = 2;

      return superimposeTemplate(currentPixel, template, bitmap);
    },

    // GBTEMPLATE=2. (section 6.2.5.3, figure 5)
    //
    // Given the location of the pixel currently being decoded, the location
    // of the adaptive template pixels, and a bitmap with the already decoded
    // bits, it will return the new context value to be used in arithmetic
    // decoding.
    //
    function (currentPixel, AT, bitmap) {
      // _ X X X _
      // X X X X 1
      // X X o _ _
      var template = [
        {y:-2, x:{min:-1, max: 1}},
        {y:-1, x:{min:-2, max: 2}},
        {y: 0, x:{min:-2, max:-1}},
      ];

      // If the locations of the adaptive template pixels are not the default
      // one, then we adjust the limit intervals of the X coordinates in the
      // template. Basically, we remove them. This is because an AT pixel is
      // ignored if it's found positioned above a normal pixel.
      if (AT[0].x !== template[1].x.max || AT[0].y !== template[1].y)
        template[1].x.max = 1;

      return superimposeTemplate(currentPixel, template, bitmap);
    },

    // GBTEMPLATE=3. (section 6.2.5.3, figure 6)
    //
    // Given the location of the pixel currently being decoded, the location
    // of the adaptive template pixels, and a bitmap with the already decoded
    // bits, it will return the new context value to be used in arithmetic
    // decoding.
    //
    function (currentPixel, AT, bitmap) {
      // _ X X X X X 1
      // X X X X o _ _
      var template = [
        {y:-1, x:{min:-3, max: 2}},
        {y: 0, x:{min:-4, max:-1}},
      ];

      // If the locations of the adaptive template pixels are not the default
      // one, then we adjust the limit intervals of the X coordinates in the
      // template. Basically, we remove them. This is because an AT pixel is
      // ignored if it's found positioned above a normal pixel.
      if (AT[0].x !== template[0].x.max || AT[0].y !== template[0].y)
        template[1].x.max = 1;

      return superimposeTemplate(currentPixel, template, bitmap);
    }
  ];

  // Expected arguments:
  //
  //  - `useMMR`: boolean, whether Modified Modified READ is used
  //  - `width`: number, region width
  //  - `height`: number, region height
  //  - `templateID`:
  //  - `useTypicalPrediction`: boolean
  //  - `skipPixels`: matrix (of size `width` by `height`) of pixels to skip
  //  - `templatePixels`: { A[4]: [{x, y}] }
  //
  var decodeGenericRegion = function (buffer, args, decode, ctx) {
    var LTP = 0;
    var bitmap = [[]];

    for (var i=0, max=args.height; i<max; i++) {
      if (args.useTypicalPrediction) {
        // 6.2.5.7. Decoding the bitmap. Step 3.b of the algorithm
        ctx.index = [
          0x9B25, // number represented by figure  8
          0x0795, // number represented by figure  9
          0x00E5, // number represented by figure 10
          0x0195, // number represented by figure 11
        ][args.templateID];

        var SLTP = decode(ctx);
        LTP ^= SLTP;
      }

      if (LTP === 1) {
        // copy row above
        bitmap[i] = Array.apply([], bitmap[i - 1]);
      } else {
        for (var j=0, jmax=args.width; j<jmax; j++) {
          if (args.skipPixels.length !== 0 && args.skipPixels[i][j]) {
            bitmap[i][j] = 0;
          } else {
            var currentPixel = {x:j, y:i};
            ctx.index = GBTEMPLATE[args.templateID](currentPixel, args.templatePixels, bitmap);
            bitmap[i] = bitmap[i] || [];
            bitmap[i][j] = decode(ctx);
          }
        }
      }
    }

    return bitmap;
  };

  var decodeBitmap = function (buffer, args, decoder, ctx) {
    if (args.useRefAgg) {

    } else {
      return decodeGenericRegion(buffer, {
        useMMR: false,
        width: args.currentSymbolWidth,
        height: args.currentHeightClass,
        templateID: args.sdTemplate,
        useTypicalPrediction: false,
        skipPixels: [],
        templatePixels: args.templatePixels.A
      }, decoder, ctx);
    }
  };

  var decodeCollectiveBitmap = function (buffer, args, decoder, args2, ctx) {
    // 6.5.9 (1)
    var size = huffman.decode(buffer, huffman.STANDARD_TABLES[args.huffmanTables.heightClassCollective]).value;

    // 6.5.9 (2)
    buffer.consumeBits();

    if (size === 0) {
      var bitmap = [];
      var bytesPerRow = Math.ceil(args2.width / 8);
      // 6.5.9 (3)
      var bytesToRead = args2.height * bytesPerRow;
      var bytes = buffer.readBytes(bytesToRead);

      var count = 0;
      for (var i=0; i<args2.height; i++) {
        for (var j=0; j<bytesPerRow; j++) {
          bitmap[i] = bitmap[i] || [];
          bitmap[i][j] = bytes[count];
          count++;
        }
      }

      var column = 0;
      var row = 0;
      var collectiveBitmap = [];
      var padding = args2.width % 8;

      for (var i = 0; i < args2.height; i++) {
        for (var j = 0; j < bytesPerRow; j++) {
          if (j === (bytesPerRow - 1)) {
            var octet = bitmap[i][j];
            for (var bitPointer = 7; bitPointer >= padding; bitPointer--) {
              var bit = (octet & (1 << bitPointer)) >> bitPointer;
              collectiveBitmap[row] = collectiveBitmap[row] || [];
              collectiveBitmap[row][column] = bit;
              column++;
            }
            row++;
            column = 0;
          } else {
            var octet = bitmap[i][j];
            for (var bitPointer = 7; bitPointer >= 0; bitPointer--) {
              var bit = (octet & (1 << bitPointer)) >> bitPointer;
              collectiveBitmap[row] = collectiveBitmap[row] || [];
              collectiveBitmap[row][column] = bit;
              column++;
            }
          }
        }
      }

      return collectiveBitmap;
    } else {
      throw new Error("Not implemented");
      // return decodeGenericRegion(buffer, {
      //   useMMR: true,
      //   width: args.currentSymbolWidth,
      //   height: args.currentHeightClass,
      //   templateID: args.sdTemplate,
      //   useTypicalPrediction: false,
      //   skipPixels: [],
      //   templatePixels: args.templatePixels.A
      // }, decoder, ctx);
    }
  };

  // Expected arguments:
  //
  //  - bitmap
  //  - width
  //  - height
  //  - symbolWidths
  //
  var splitCollectiveBitmap = function (args) {
    var bitmaps = [];
    var decodedWidth = 0;

    for (var i=0, ii=args.symbolWidths.length; i<ii; i++) {
      var bitmap = [];
      var width = args.symbolWidths[i];

      for (var j=0, jj=args.height; j<jj; j++) {
        bitmap[j] = args.bitmap[j].slice(decodedWidth, decodedWidth + width);
      }

      decodedWidth += width;
      bitmaps.push(bitmap);
    }

    return bitmaps;
  };

  var decoders = {
    // Params:
    //
    //  - `useHuffman`: boolean, use Huffman coding
    //  - `useRefAgg`: boolean, use refinement and aggregate coding
    //  - `inputSymbols`: array of symbols
    //  - `definedSymbols`: number
    //  - `exportedSymbols`: number
    //  - `huffmanTables`: { deltaWidth, deltaHeight, heightClass, aggregationInstances }
    //  - `sdTemplate`: number
    //  - `refinementBitmapTemplate`: number
    //  - `templatePixels`: { A[4]: [{x, y}], RA[2]: [{x, y}]}
    //
    // Returns: an array of symbols
    //
    symbolDictionary: function (buffer, args) {
      var symbols = [];

      if (args.useHuffman && !args.useRefAgg) {
        var newSymbolWidths = [];
      }

      var decodedSymbols = 0;
      var currentHeightClass = 0;
      var currentSymbolWidth = 0;
      var currentHeightClassWidth = 0;
      var totalWidth = 0;
      var firstSymbolInCurrentHeightClass;

      if (!args.useHuffman) {
        decodingContexts.IADH = new ArithmeticContext(512, 0);
        decodingContexts.IADW = new ArithmeticContext(512, 0);
        var regionCtx = new ArithmeticContext(65536, 0);
        var decode = ArithmeticCoder.decoder(buffer);
      }

      while (symbols.length < args.definedSymbols) {
        var deltaHeight = decodeHeightClassDeltaHeight(buffer, args, decode);
        currentHeightClass = currentHeightClass + deltaHeight.value;
        currentSymbolWidth = 0;
        currentHeightClassWidth = 0;
        firstSymbolInCurrentHeightClass = decodedSymbols;

        while (true) {
          var deltaWidth = decodeHeightClassDeltaWidth(buffer, args, decode);

          if (deltaWidth.isOOB) {
            break;
          }

          currentSymbolWidth = currentSymbolWidth + deltaWidth.value;
          totalWidth = totalWidth + currentSymbolWidth;

          if (!args.useHuffman || args.useRefAgg) {
            // direct-coded symbol bitmap
            var bitmap = decodeBitmap(buffer, {
              currentSymbolWidth: currentSymbolWidth,
              currentHeightClass: currentHeightClass,
              sdTemplate:         args.sdTemplate,
              templatePixels:     args.templatePixels
            }, decode, regionCtx);

            symbols.push(bitmap);
          }

          if (args.useHuffman && !args.useRefAgg) {
            newSymbolWidths.push(currentSymbolWidth);
          }

          decodedSymbols++;
        }

        if (args.useHuffman && !args.useRefAgg) {
          var bitmap = decodeCollectiveBitmap(buffer, args, decode, {
            height: currentHeightClass,
            width: totalWidth
          }, regionCtx);
          symbols = symbols.concat(splitCollectiveBitmap({
            bitmap: bitmap,
            width: totalWidth,
            height: currentHeightClass,
            symbolWidths: newSymbolWidths
          }));
        }
      }

      return symbols;
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
    var bitPointer = 7;
    var bytePointer = 0;

    return {
      consumeBits: function () {
        bitPointer = 7;
        bytePointer++;
      },

      readBit : function () {
        var octet = buffer[bytePointer];
        var bit = (octet & (1 << bitPointer)) >> bitPointer;

        bitPointer--;

        if (bitPointer === -1) {
          bitPointer = 7;
          bytePointer++;
        }

        return bit;
      },

      readBits: function (n) {
        var bits = 0;
        while (n--) {
          bits = (bits << 1) | this.readBit();
        }
        return bits;
      },

      readByte: function () {
        bitPointer = 0;
        return buffer[bytePointer++];
      },

      readBytes: function (n) {
        var bytes = buffer.subarray(bytePointer, bytePointer + n);
        bytePointer += n;
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
    dataHeader.useHuffman = dataHeader.encoding === HUFFMAN_ENCODING;
    dataHeader.useRefAgg = (rightByte & 0x02) === 0x02;

    // This should only be parsed when dataHeader.encoding = HUFFMAN_ENCODING.
    var deltaHeight = (rightByte & 0x0C) >> 2;
    var deltaHeightTable;
    switch (deltaHeight) {
      case 0: deltaHeightTable = "B4"; break;
      case 1: deltaHeightTable = "B5"; break;
      case 2: throw new Error("Illegal value");
      case 3: deltaHeightTable = "USER_DEFINED"; break;
    }

    // This should only be parsed when dataHeader.encoding = HUFFMAN_ENCODING.
    var deltaWidth = (rightByte & 0x30) >> 4;
    var deltaWidthTable;
    switch (deltaWidth) {
      case 0: deltaWidthTable = "B2"; break;
      case 1: deltaWidthTable = "B3"; break;
      case 2: throw new Error("Illegal value");
      case 3: deltaWidthTable = "USER_DEFINED"; break;
    }

    var heightClassCollective = ((rightByte & 0x30) >> 6) === 0x00 ? "B1" : "USER_DEFINED";
    var aggregationSymbolInstanceCount = ((rightByte & 0x40) >> 7) === 0x00 ? "B1" : "USER_DEFINED";

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
    if (dataHeader.useRefAgg && dataHeader.sdrTemplate === 0) {
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

    if (!parsedDataHeader.useHuffman) {
      parseSymboldDictionaryATFlags(parsedDataHeader, buffer);
    }

    if (parsedDataHeader.useRefAgg && !parsedDataHeader.sdrTemplate) {
      parseSymbolDictionaryRefinementATFlags(parsedDataHeader, buffer);
    }

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

    decoders: decoders,

    decodeGenericRegion: decodeGenericRegion,

    GBTEMPLATE: GBTEMPLATE,

    parse: function (buffer) {
      var stream  = streamFrom(buffer);
      var decoded = {};

      decodeHeader(decoded, stream);
      parseSegmentHeader(stream);

      return decoded;
    }
  };
})(this);
