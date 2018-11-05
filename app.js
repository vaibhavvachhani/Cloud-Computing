const express = require("express");
const app = express();
const request = require("request");
const async = require("async");
var http = require("http");
var fileSystem = require('fs');
var Sentiment = require('sentiment');
var sentiment = new Sentiment();
app.use(express.static('public'));


// Imports the Google Cloud client library
const language = require('@google-cloud/language');

// Creates a client
const client = new language.LanguageServiceClient(
    {
  keyFilename: './google.json' //path to gfile containing API key
}
);

//present the user with a form to use application
app.get('/', function(req, res){ 
      fileSystem.readFile('./index.html', function(error, fileContent){
        if(error){
            res.writeHead(500,{'Content-Type': 'text/plain'});
            res.end('Error');
        }
        else{
            res.writeHead(200, {'Content-Type': 'text/html'});
			res.write(fileContent);
            res.end();
        }
    });

});

const PORT = 3000;

// function for using flickr API
function flickrRequest(options, cb) {
    request({
        method : "GET",
        url: "https://api.flickr.com/services/rest/?",
        qs: Object.assign({
            "api_key": "a5bc0ff84bf86a9d7b8e9313b4fa3388",
            "format": "json",
            "nojsoncallback": "1",
        }, options)
    }, cb);
}

// functions for using bing's goelocation API 
function getGeoCoordinates(options, cb) {
    request({
        method : "GET",
        url: "http://dev.virtualearth.net/REST/v1/Locations",
        qs: Object.assign({
            "key": 'AtI4auLCnkAtRRzWs2mfYexeMMx3ZZKLL_-oerA45wAXLqZ3v0ptj6XCkRjKDC4v',
        }, options)
    }, cb);
}

app.set('view engine', 'pug') //set the view

app.get('/response', (req, res) => {

    let ad = req.query.add; //address entered by user
    let tag = req.query.tag; // query entered by user
    
    async.waterfall([
        cb => getGeoCoordinates({
            "q": ad,
    }, (error, response, body) => {
        if(error)
        {
            cb(error);
        }
        else {
            const json_address = JSON.parse(body);
            // assign latitude and longitude variables
            let long = json_address.resourceSets[0].resources[0].geocodePoints[0].coordinates[1];
            let lati = json_address.resourceSets[0].resources[0].geocodePoints[0].coordinates[0];

            cb(null, lati, long, tag);
        }

    }),
    (lati, long, tag, callback) => 

    // get photos taken at that location
    flickrRequest({
            "method": "flickr.photos.search",
            "lat": lati, // passing co-ordinates to flickr API
            "lon": long,
            "text": tag,
        }, (error, respone, body) => {

        if( error || respone.statusCode != 200) {
            res.statusCode(500);
            res.end("ERROR");            
        }
        
       const json_respone = JSON.parse(body);
       const req_comments = [];

       //get comments from each photo
       for(let num = 0; num < json_respone.photos.photo.length; num++)
       {
           
           var p_id = json_respone.photos.photo[num].id; //storing photo_id of the current photo
           const req_func = (cb) => flickrRequest({
            "method": "flickr.photos.comments.getList",
            "photo_id": json_respone.photos.photo[num].id
           }, (error, respone, body) => {

            if( error || respone.statusCode != 200)
             {
                cb(error || 'error');       
             }
            else {
                cb(null, body);
                 }
            

        })

        req_comments.push(req_func); //collecting requests to get the comments from photos
       }
       async.parallel(req_comments,  

       function(error, results){
           if(error)
           {
               console.log(error);
           }
           else {
          const forClient = results
         
            .map(res => JSON.parse(res))
            .filter(function(com) {
                return com.comments.comment != null;
            })
            .map(item => {
              const photo_id = item.comments.photo_id;
              var coms_arr = [];
              for(let x=0; x< item.comments.comment.length; x++)
                  {
                    coms_arr.push(item.comments.comment[x]._content);
                  }
                  //remove null values
              var clean_comments = coms_arr.filter(function(obj) { 
                      return (obj !== (undefined || null || 'null'));
                     });

              return clean_comments;
                
             
          });

          let comment_string = JSON.stringify(forClient);
          var output = sentiment.analyze(comment_string);

          // filtering positive words and negative words array to omit repeatitions
          var pos = output.positive.filter(function(elem, index, self) { 
             return index == self.indexOf(elem);
          });

          var neg = output.negative.filter(function(elem, index, self) {
             return index == self.indexOf(elem);
          });

        
        //display words on which comparitive score is based on
          let arrayOfWords=[];
          if(output.negative.length > output.positive.length)
          {
            for(var i=0;i<neg.length; i++)
            {
                arrayOfWords.push(neg[i]);
            }
              
          }
          else {
            for(var i=0;i<pos.length; i++)
            {
                arrayOfWords.push(pos[i]);
            }
          }

          const doc = {
            content: comment_string,
            type: 'PLAIN_TEXT',
        };
            // Detects the sentiment of the document
            client
            .analyzeSentiment({document: doc})
            .then(results => {
                let score1 = 0;
                let num = 0;
                const sentences = results[0].sentences;
                sentences.forEach(sentence => {
                
                score1 = score1 + sentence.sentiment.score;
                num = num + 1;
                });
                let score = results[0].documentSentiment.score;
               
                let score_string = ("Overall review score: " + (score1/num));

                // send the response to the browser via view
                res.render('chart', { 
                    heading: 'Result analysis',
                    result: score_string,
                    positive: output.positive.length,
                    negative: output.negative.length,
                    words: arrayOfWords.toString(),
                    address: ad,
                    query: tag,
                    
                })

            })
            // if error with analysis 
            .catch(err => {
                console.error('ERROR:', err);
            });
          
          

        }

       });    
      
    })
    ], (err, result) => {
      if (err) {
          console.log(err);
      }
      
    })
    


})

app.listen(PORT, () => {
    console.log("Server is listening on PORT " + PORT);
});