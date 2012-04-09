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
      if (buffer[i] !== n) {
        throw new Error("Control header check has failed");
      }
    });

    var headerFlags = buffer[8];
    decoded = parseHeaderFlags(headerFlags, decoded);

    if (decoded.knownPageCount) {
      decoded.pageCount = int32(buffer.subarray(9, 13));
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
  var decodeFirstSegment = function (decoded, buffer) {
    var segment = {};
    var start   = decoded.knownPageCount ? 14 : 9;

    segment.number = int32(buffer.subarray(start, start + 4));
    segment.flags  = decodeSegmentHeaderFlags(buffer.subarray(start + 5, 1));

    console.log(segment);
  };

  global.JBIG2 = {
    SEQUENTIAL: SEQUENTIAL,
    RANDOM_ACCESS: RANDOM_ACCESS,

    parse: function (buffer) {
      var decoded = {};

      decodeHeader(decoded, buffer);
      decodeFirstSegment(decoded, buffer);

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




