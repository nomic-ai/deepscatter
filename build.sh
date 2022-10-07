npm run build;
sed '/Cannot create Schema containing two/ d' ./dist/deepscatter.js > ./dist/deepscatter.es.js
