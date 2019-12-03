const express = require('express');
const crypto = require('crypto');
var exec = require('child_process').execFile;
const app = express();
var formidable = require('formidable');
app.use(express.json())
app.get('/v1/autodock', (req, res) => {
    res.send('Hello World!')
});

app.post('/v1/autodock', (req, res) => {
    ligend = {}
    macromolecule = {}
    fields = {}
    var form = new formidable.IncomingForm();
    form.multiples = true;
    form.parse(req);
    form.on('field', function(name, value) {
        fields[name] = value
    })
    form.on('fileBegin', function (name, file){
        let nameHash = crypto.createHmac('sha1', crypto.randomBytes(48))
        .update(Date.now()
        .toString())
        .digest('hex')
        if (name == 'ligend') {
            ligend.originalName = name
            ligend.name = nameHash
        }
        else if (name == 'macromolecule') {
            macromolecule.originalName = name
            macromolecule.name = nameHash
        }
        else {
            res.status(400);
            res.send('Unknown file name parameter: ' + name);
        }
        file.path = __dirname + '/uploads/' + nameHash + '.pdbqt';
    });
    form.on('end', function() {
        try {
            argsString = 
            ' --receptor ' +  __dirname + '/uploads/' + macromolecule.name + '.pdbqt' +  
            ' --ligand ' + __dirname + '/uploads/' + ligend.name + '.pdbqt' +
            ' --center_x ' + fields['center_x'] +
            ' --center_y ' + fields['center_y'] +
            ' --center_z ' + fields['center_z'] +
            ' --size_x ' + fields['size_x'] +
            ' --size_y ' + fields['size_y'] +
            ' --size_z ' + fields['size_z'] 
        }
        catch(err) {
            res.status(400)
            res.send('Incorrect arguments provided.')
        }
        try {
            exec(`${__dirname}/vina ` + argsString, function(error, stdout, stderr) {
                console.log(stdout)
                console.log(stderr)
                console.log(error)
            });
        }
        catch(error) {
            res.status(400)
            res.send('Execution error: ' + error)
        }
    });

});

app.listen(8000, () => {
    console.log('Listening on port 8000.')
})