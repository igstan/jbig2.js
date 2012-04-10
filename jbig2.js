;(function (global) {
  "use strict";

  var SEQUENTIAL    = "SEQUENTIAL";
  var RANDOM_ACCESS = "RANDOM_ACCESS";
  var controlHeader = [0x97, 0x4A, 0x42, 0x32, 0x0D, 0x0A, 0x1A, 0x0A];

  var int32 = function (number) {
    return (number[0] << 24) | (number[1] << 16) | (number[2] << 8) | number[3];
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

  var decodeSegmentHeaderFlags = function (flags) {
    return {
      deferredNonRetain:   flags & 0x80 === 0x80, // 1000 0000
      pageAssociationSize: flags & 0x40 === 0x40, // 0100 0000
      segmentType:         flags & 0x3F === 0x3F  // 0011 1111
    };
  };

  var decodeRefSegmentCountAndRetentionFlags = function (buffer) {
    var retentionFlags;
    var octet = buffer.readByte();

    console.log(octet);

    var refSegmentCount = (octet & 0xE0) >> 5;

    if (refSegmentCount <= 4) {
      retentionFlags = octet;
    } else if (refSegmentCount === 7) {
      var longFormCountAndFlags = new Uint8Array([
        (octet ^ 0xe0),    // bits 0-4, i.e. we drop the refSegmentCount
        buffer.readByte(),
        buffer.readByte(),
        buffer.readByte()
      ]);

      refSegmentCount = int32(longFormCountAndFlags);

      // see section 7.2.4 of the specs
      var bytesToRead = 4 + Math.ceil((refSegmentCount + 1) / 8);
      var noOfRententionFlagBytes = bytesToRead - 4;
      retentionFlags = buffer.readBytes(noOfRententionFlagBytes);

    } else {
      throw new Error(
        'Invalid value for the "count of referred-to segments" in the ' +
        '3-bit subfield. It must be either 4 or 7, but got: ' + refSegmentCount
      );
    }

    console.log(retentionFlags);

    return retentionFlags;
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
  var decodeFirstSegment = function (buffer) {
    var segment = {};

    segment.number = buffer.readInt32();
    segment.flags  = decodeSegmentHeaderFlags(buffer.readByte());
    segment.refSegmentCountAndRetentionFlags = decodeRefSegmentCountAndRetentionFlags(buffer);

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
      }
    };
  };

  global.JBIG2 = {
    SEQUENTIAL: SEQUENTIAL,
    RANDOM_ACCESS: RANDOM_ACCESS,

    streamFrom: streamFrom,
    parseSegmentHeader: decodeFirstSegment,

    parse: function (buffer) {
      var stream  = streamFrom(buffer);
      var decoded = {};

      decodeHeader(decoded, stream);
      decodeFirstSegment(stream);

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




