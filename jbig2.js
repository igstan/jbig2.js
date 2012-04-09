;(function (global) {

  global.JBIG2 = {
    parse: function (buffer) {
      return {
        pageCount: 3
      };
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




