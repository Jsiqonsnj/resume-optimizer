/* =========================================================
 * radar.js — 五维分雷达（纯 SVG，无外部库、无图片）
 * ---------------------------------------------------------
 * 为什么自己画：file:// 下不能指望 CDN，也不该为一张图多拉 100KB。
 * 只算坐标、拼字符串，任何 scale 下都清晰。
 * ========================================================= */

(function (global) {
  "use strict";

  var W = 268;
  var H = 236;
  var CX = W / 2;
  var CY = 118;
  var R = 74;
  var RINGS = [0.34, 0.67, 1];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function point(i, n, radius) {
    var ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    return { x: CX + Math.cos(ang) * radius, y: CY + Math.sin(ang) * radius, ang: ang };
  }

  function ring(n, ratio) {
    var d = [];
    for (var i = 0; i < n; i++) {
      var p = point(i, n, R * ratio);
      d.push((i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1));
    }
    return d.join(" ") + " Z";
  }

  function svg(dims) {
    var list = (dims || []).filter(function (d) { return d && d.name; });
    if (list.length < 3) return "";
    var n = list.length;

    var grid = RINGS.map(function (r) {
      return '<path d="' + ring(n, r) + '" fill="none" stroke="#E7E7E2" stroke-width="1"/>';
    }).join("");

    var axes = "";
    for (var i = 0; i < n; i++) {
      var p = point(i, n, R);
      axes += '<line x1="' + CX + '" y1="' + CY + '" x2="' + p.x.toFixed(1) +
        '" y2="' + p.y.toFixed(1) + '" stroke="#EFEFEA" stroke-width="1"/>';
    }

    var pts = list.map(function (d, k) {
      var max = d.max || 100;
      var ratio = Math.max(0.04, Math.min(1, (d.score || 0) / max));
      return point(k, n, R * ratio);
    });
    var poly = pts.map(function (p, k) {
      return (k ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1);
    }).join(" ") + " Z";

    var dots = pts.map(function (p) {
      return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) +
        '" r="2.8" fill="#fff" stroke="#1B3A57" stroke-width="1.6"/>';
    }).join("");

    var labels = list.map(function (d, k) {
      var a = (Math.PI * 2 * k) / n - Math.PI / 2;
      var lx = CX + Math.cos(a) * (R + 18);
      var ly = CY + Math.sin(a) * (R + 18);
      var cos = Math.cos(a);
      var anchor = cos > 0.35 ? "start" : (cos < -0.35 ? "end" : "middle");
      var dy = Math.sin(a) > 0.6 ? 10 : (Math.sin(a) < -0.6 ? -6 : 2);
      var name = d.name.length > 6 ? d.name.slice(0, 6) : d.name;
      return '' +
        '<text x="' + lx.toFixed(1) + '" y="' + (ly + dy).toFixed(1) + '" text-anchor="' + anchor + '"' +
          ' font-size="10.5" fill="#6B6B62">' + esc(name) + "</text>" +
        '<text x="' + lx.toFixed(1) + '" y="' + (ly + dy + 13).toFixed(1) + '" text-anchor="' + anchor + '"' +
          ' font-size="11.5" font-weight="600" fill="#1B3A57">' + (d.score || 0) +
          '<tspan font-size="9" font-weight="400" fill="#9A9A92">/' + (d.max || 100) + "</tspan></text>";
    }).join("");

    return '' +
      '<svg class="radar" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '"' +
        ' role="img" aria-label="五维评分雷达图" preserveAspectRatio="xMidYMid meet">' +
        grid + axes +
        '<path d="' + poly + '" fill="rgba(27,58,87,.13)" stroke="#1B3A57" stroke-width="1.5"' +
          ' stroke-linejoin="round"/>' +
        dots + labels +
      "</svg>";
  }

  global.Radar = { svg: svg };

  /* 给离线测试用：直接算数据点 */
  global.Radar.points = function (dims, radius) {
    var list = (dims || []).filter(function (d) { return d && d.name; });
    return list.map(function (d, k) {
      return point(k, list.length, (radius || R) * Math.max(0.04, Math.min(1, (d.score || 0) / (d.max || 100))));
    });
  };
})(typeof window !== "undefined" ? window : globalThis);