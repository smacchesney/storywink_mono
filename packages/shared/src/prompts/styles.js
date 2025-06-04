// ----------------------------------
// STYLE LIBRARY
// ----------------------------------
export const STYLE_LIBRARY = {
    anime: {
        label: 'Anime',
        referenceImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1746284318/Anime_USETHIS_qmgm0i.png',
    },
    pen: {
        label: 'Pen',
        referenceImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1746283996/pen_USETHIS_nqfnel.png',
    },
    watercolor: {
        label: 'Watercolor',
        referenceImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1746284308/Watercolor_USETHIS3_n2giqf.png',
    },
    modern: {
        label: 'Modern',
        referenceImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1746283996/modern_USETHIS_dukxgz.png',
    },
    pencil: {
        label: 'Pencil',
        referenceImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1746283997/pencil_USEHTIS_htcslm.png',
    },
    bwPlusOne: {
        label: 'B&W +1 Color',
        referenceImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1746283997/bw_1col_USETHIS_pvbovo.png',
        description: "As per the reference image, black and white EXCEPT exactly one prominent object (not people) of the model's choosing",
    },
};
// Type-safe style library
export const TypedStyleLibrary = STYLE_LIBRARY;
// ----------------------------------
// UTILITY FUNCTIONS
// ----------------------------------
export function isValidStyle(style) {
    return style in STYLE_LIBRARY;
}
export function getStyleDefinition(style) {
    return TypedStyleLibrary[style];
}
export function getAllStyleKeys() {
    return Object.keys(STYLE_LIBRARY);
}
export function getStyleLabel(style) {
    return TypedStyleLibrary[style].label;
}
export function getStyleReferenceUrl(style) {
    return TypedStyleLibrary[style].referenceImageUrl;
}
