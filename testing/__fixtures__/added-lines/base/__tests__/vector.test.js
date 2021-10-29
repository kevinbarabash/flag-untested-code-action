const Vector = require("../vector.js");

describe("#length", () => {
    it.each`
        vector | length
        ${new Vector(0, 0)} | ${0}
        ${new Vector(3, 4)} | ${5}
    `(`$vector.length = $length`, ({vector, length}) => {
        expect(vector.length).toEqual(length);
    });
});
