;(function (global) {
  "use strict";

  var hex = function (n) {
    return "0x" + n.toString(16);
  };

  var Qe = [
    0x5601, 0x3401, 0x1801, 0x0AC1, 0x0521, 0x0221, 0x5601, 0x5401, 0x4801,
    0x3801, 0x3001, 0x2401, 0x1C01, 0x1601, 0x5601, 0x5401, 0x5101, 0x4801,
    0x3801, 0x3401, 0x3001, 0x2801, 0x2401, 0x2201, 0x1C01, 0x1801, 0x1601,
    0x1401, 0x1201, 0x1101, 0x0AC1, 0x09C1, 0x08A1, 0x0521, 0x0441, 0x02A1,
    0x0221, 0x0141, 0x0111, 0x0085, 0x0049, 0x0025, 0x0015, 0x0009, 0x0005,
    0x0001, 0x5601
  ];

  var NMPS = [
    1, 2, 3, 4, 5, 38, 7, 8, 9, 10, 11, 12, 13, 29, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38,
    39, 40, 41, 42, 43, 44, 45, 45, 46
  ];

  var NLPS = [
    1, 6, 9, 12, 29, 33, 6, 14, 14, 14, 17, 18, 20, 21, 14, 14, 15, 16, 17,
    18, 19, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
    35, 36, 37, 38, 39, 40, 41, 42, 43, 46
  ];

  var SWITCH = [
    1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ];

  // Arithmetic Encoding Procedure
  // ---------------------------------------------------------------------------
  function encode(data) {
    // Helpers
    var nextBit = (function () {
      var byteIndex = 0;
      var bitIndex = 0; // bit index to read
      return function () {
        if (byteIndex === data.length) {
          return null;
        }

        var octet = data[byteIndex];
        var bit = (octet & (0x80 >> bitIndex)) >> (7 - bitIndex);

        bitIndex += 1;

        if (bitIndex === 8) {
          bitIndex = 0;
          // we've read all bits in this byte, move the byte pointer forward
          byteIndex++;
        }

        return bit;
      };
    })();

    // Encoder Initialization
    // -------------------------------------------------------------------------
    var A    = 0x8000;   // interval register
    var C    = 0x0000;   // code register
    var BPST = 0;
    var BP   = BPST - 1; // byte pointer
    var CT   = 12;       // bit counter
    var MPS  = 0;        // the array, indexed by CX, of the current more probable binary values
    var ICX  = 0;        // the array, indexed by CX, of the indices of the adaptive probability estimates: Qe
    var B    = [];

    // I don't get it. Why would I have a byte before I actually start
    // outputting bytes?!
    if (B[BP] === 0xFF) {
      CT = 13;
    }

    // start
    var D = nextBit();
    while (D !== null) {
      // ENCODE. See Figure E.3 in the specification.
      if (D === 0) {
        code0();
      } else {
        code1();
      }

      D = nextBit();
    }

    flush();

    // FLUSH. See Figure E.11 in the specification.
    function flush() {
      setBits();
      C = C << CT;
      byteOut();
      C = C << CT;
      byteOut();

      if (B[BP] !== 0xFF) {
        BP = BP + 1;
        B[BP] = 0xFF;
      }

      BP = BP + 1;
      B[BP] = 0xAC;
      BP = BP + 1;
    }

    function setBits() {
      var TEMPC = C + A;
      C = C | 0xFFFF;

      if (C >= TEMPC) {
        C = C - 0x8000;
      }
    }

    // CODE1. See Figure E.4 in the specification.
    function code1() {
      if (MPS === 1) codeMPS(); else codeLPS();
    }

    // CODE0. See Figure E.5 in the specification.
    function code0() {
      if (MPS === 0) codeMPS(); else codeLPS();
    }

    // CODEMPS. See Figure E.7 in the specification.
    function codeMPS() {
      A = A - Qe[ICX];

      if ((A & 0x8000) === 0) {
        if (A < Qe[ICX]) {
          A = Qe[ICX];
        } else {
          C = C + Qe[ICX];
        }

        ICX = NMPS[ICX];
        renorme();
      } else {
        C = C + Qe[ICX];
      }
    }

    // CODELPS. See Figure E.6 in the specification.
    function codeLPS() {
      A = A - Qe[ICX];

      if (A < Qe[ICX]) {
        C = C + Qe[ICX];
      } else {
        A = Qe[ICX];
      }

      if (SWITCH[ICX]) {
        MPS = 1 - MPS;
      }

      ICX = NLPS[ICX];
      renorme();
    }

    // RENORME. See Figure E.8 in the specification.
    function renorme() {
      do {
        A  = A << 1;
        C  = C << 1;
        CT = CT - 1;

        if (CT === 0) {
          byteOut();
        }
      } while ((A & 0x8000) === 0);
    }

    // BYTEOUT. See Figure E.9 in the specification.
    function byteOut() {
      if (B[BP] === 0xFF) {
        BP    = BP + 1;
        B[BP] = (C >> 20) & 0xFF;
        C     = C & 0xFFFFF;
        CT    = 7;
      } else {
        if (C < 0x8000000) {
          BP    = BP + 1;
          B[BP] = (C >> 19) & 0xFF;
          C     = C & 0x7FFFF;
          CT    = 8;
        } else {
          B[BP] = B[BP] + 1;

          if (B[BP] === 0xFF) {
            C     = C & 0x7FFFFFF;
            BP    = BP + 1;
            B[BP] = (C >> 20) & 0xFF;
            C     = C & 0xFFFFF;
            CT    = 7;
          } else {
            BP    = BP + 1;
            B[BP] = (C >> 19) & 0xFF;
            C     = C & 0x7FFFF;
            CT    = 8;
          }
        }
      }
    }

    return B;
  }

  global.ArithmeticCoder = {
    encode: encode
  };

})(this);
