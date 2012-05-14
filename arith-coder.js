;(function (global) {
  "use strict";

  // Values for Qe, NMPS, NLPS and SWITCH are taken from Table E.1 in the spec.
  var Qe = [ // Probability table for symbols.
    0x5601, 0x3401, 0x1801, 0x0AC1, 0x0521, 0x0221, 0x5601, 0x5401, 0x4801,
    0x3801, 0x3001, 0x2401, 0x1C01, 0x1601, 0x5601, 0x5401, 0x5101, 0x4801,
    0x3801, 0x3401, 0x3001, 0x2801, 0x2401, 0x2201, 0x1C01, 0x1801, 0x1601,
    0x1401, 0x1201, 0x1101, 0x0AC1, 0x09C1, 0x08A1, 0x0521, 0x0441, 0x02A1,
    0x0221, 0x0141, 0x0111, 0x0085, 0x0049, 0x0025, 0x0015, 0x0009, 0x0005,
    0x0001, 0x5601
  ];

  var NMPS = [ // Next More Probable Symbol
    1, 2, 3, 4, 5, 38, 7, 8, 9, 10, 11, 12, 13, 29, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38,
    39, 40, 41, 42, 43, 44, 45, 45, 46
  ];

  var NLPS = [ // Next Less Probable Symbol
    1, 6, 9, 12, 29, 33, 6, 14, 14, 14, 17, 18, 20, 21, 14, 14, 15, 16, 17,
    18, 19, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
    35, 36, 37, 38, 39, 40, 41, 42, 43, 46
  ];

  var SWITCH = [ // Switch MPS and LPS on an LPS renormalisation?
    1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ];

  // DECODER. See Figures E.13 and E.14 in the specification.
  function decoder(stream) {
    var Long = goog.math.Long;

    var B,  // current byte of arithmetically-coded data
        B1, // byte of arithmetically-coded data following the current byte
        C,  // value of bit stream in code register
        A,  // probability interval
        CT; // renormalization shift counter

    // INITDEC. See Figure E.20 in the specification.
    var initDecoder = function () {
      B     = stream.readByte();
      B1    = stream.readByte();
      C     = Long.fromInt(B << 16);
      byteIn();
      C  = C.shiftLeft(7);
      CT = CT - 7;
      A  = 0x8000;
    }

    // BYTEIN. See Figure E.19 in the specification.
    var byteIn = function () {
      if (B === 0xFF) {
        if (B1 > 0x8F) {
          C  = C.add(Long.fromInt(0xFF00));
          CT = 8;
        } else {
          B  = B1;
          B1 = stream.readByte();
          C  = C.add(Long.fromInt(B << 9));
          CT = 7;
        }
      } else {
        B  = B1;
        B1 = stream.readByte();
        C  = C.add(Long.fromInt(B << 8));
        CT = 8;
      }
    }

    // MPS_EXCHANGE. See Figure E.16 in the specification.
    var mpsExchange = function (CX) {
      var D;

      if (A < Qe[CX.I]) {
        D = 1 - CX.MPS;

        if (SWITCH[CX.I] === 1) {
          CX.MPS = 1 - CX.MPS;
        }

        CX.I = NLPS[CX.I];
      } else {
        D = CX.MPS;
        CX.I = NMPS[CX.I];
      }

      return D;
    }

    // LPS_EXCHANGE. See Figure E.17 in the specification.
    var lpsExchange = function (CX) {
      var D;

      if (A < Qe[CX.I]) {
        A = Qe[CX.I];
        D = CX.MPS;
        CX.I = NMPS[CX.I];
      } else {
        A = Qe[CX.I];
        D = 1 - CX.MPS;

        if (SWITCH[CX.I] === 1) {
          CX.MPS = 1 - CX.MPS;
        }

        CX.I = NLPS[CX.I];
      }

      return D;
    }

    // RENORMD. See Figure E.18 in the specification.
    var renormd = function () {
      do {
        if (CT === 0) {
          byteIn();
        }

        A  = A << 1;
        C  = C.shiftLeft(1);
        CT = CT - 1;
      } while ((A & 0x8000) === 0);
    }

    initDecoder();

    // DECODE. See Figure E.15 in the specification.
    return function (CX) {
      var D;

      A = A - Qe[CX.I];

      if (C.shiftRight(16).lessThan(Long.fromInt(Qe[CX.I]))) {
        D = lpsExchange(CX);
        renormd();
      } else {
        C = C.subtract(Long.fromInt(Qe[CX.I]).shiftLeft(16));
        if ((A & 0x8000) === 0) {
          D = mpsExchange(CX);
          renormd();
        } else {
          D = CX.MPS;
        }
      }

      return D;
    };
  }

  function ArithmeticContext(size, index) {
    this.index = index;
    this.i     = new Uint8Array(size);
    this.mps   = new Uint8Array(size);
  }

  ArithmeticContext.prototype = {
    get I()        { return this.i[this.index];    },
    set I(value)   { this.i[this.index] = value;   },
    get MPS()      { return this.mps[this.index];  },
    set MPS(value) { this.mps[this.index] = value; }
  };

  global.ArithmeticCoder = {
    decoder: decoder
  };

  global.ArithmeticContext = ArithmeticContext;

})(this);
