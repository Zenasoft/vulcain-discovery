//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.
//
//    Copyright (c) Zenasoft
//
import 'reflect-metadata'

var Table = require('easy-table')

interface Argument {
    name:string;
    alias:string;
    longAlias:string;
    defaultValue:any;
    type:string;
    multiple:boolean;
    description:string;
    env:string;
    defaultArgument:boolean;
    set?:boolean;
}

interface Section 
{
    name:string;
    sections: {[name:string]: Section};
    handler: (args:Array<Argument>)=>void;  
    description:string;   
    arguments:Array<Argument>;            
}

export interface SectionOptions {
    name?:string;
    description:string;
}

export function Section(options:SectionOptions) 
{
	return (target, key) => {
        let type = Reflect.getOwnMetadata("design:type", target, key);
        if(type.name === "String") throw "Invalid section property type. Must be an object."
        let section = JSON.parse(JSON.stringify(type.prototype));
        target.$section = target.$section || {arguments:[], sections:{}};
        let name = (options && options.name || key);
        section.$section.name=name;
        section.$section.description = options && options.description;
        target.$section.sections[name] = section; 
	}
}

export interface ArgumentOptions {
    name?:string;
    description:string;
    alias?:string;
    defaultValue?:any;
    env?:string;
}

export function DefaultArgument(options?:ArgumentOptions) {
	return (target, key) => 
    {
        let type = Reflect.getOwnMetadata("design:type", target, key);
        target.$section = target.$section || {arguments:[], sections:{}};
        let name = (options && options.name || key);
        let alias = (name.length > 1 ? "--" : "-") + name;    
        let longAlias;
        if(options && options.alias) 
            longAlias = (options && options.alias.length > 1 ? "--" : "-") + options && options.alias;          
        let multiple = !!type.isArray;
        target.$section.arguments.push(
        {
            name:key, 
            defaultArgument:true,
            alias:alias, 
            longAlias:longAlias,
            description:options && options.description, 
            defaultValue:options && options.defaultValue,
            multiple:multiple,
            env: options && options.env,
            type: multiple ? "string" : type.name.toLowerCase()
        });
	}
}

export function Argument(options:ArgumentOptions) {
	return (target, key) => 
    {
        let type = Reflect.getOwnMetadata("design:type", target, key);
        target.$section = target.$section || {arguments:[], sections:{}};
        let name = (options && options.name || key);
        let alias = (name.length > 1 ? "--" : "-") + name;    
        let longAlias;
        if(options && options.alias) 
            longAlias = (options.alias.length > 1 ? "--" : "-") + options.alias;          
        let multiple = !!type.isArray;
        target.$section.arguments.push(
        {
            name:key, 
            defaultArgument:false,
            alias:alias, 
            longAlias:longAlias,
            description:options && options.description, 
            defaultValue:options && options.defaultValue,
            multiple:multiple,
            env: options && options.env,
            type: multiple ? "string" : type.name.toLowerCase()
        });
	}
}

export interface VerbOptions 
{
    name?:string;
    description:string; 
    handler: string | ((args:{[name:string]:any})=>number);
}

export function Verb(options:VerbOptions) {
	return (target, key) => 
    {
        let type = Reflect.getOwnMetadata("design:type", target, key);
        let verb;
        if(type.name === "String")
            verb = {$section:{}};
        else
            verb = JSON.parse(JSON.stringify(type.prototype));
            
        target.$section = target.$section || {arguments:[], sections:{}};
        let name = (options && options.name || key);
        verb.$section.handler = options && options.handler;
        verb.$section.name = name;
        verb.$section.description = options && options.description;
        target.$section.sections["$verb_" + name] = verb;
	}
}

export class Parser {
	
	constructor(private name:string, private description:string) {
	}

    run<T>(options) : T 
    {
        let result;
        if(options && options.$section) 
        {
            let root =  Object.getPrototypeOf(options).$section;
            let params = <T>{};
            try 
            {
                root.arguments.forEach(a => 
                {
                    if(a.defaultValue || a.env)
                        params[a.name] = (a.env && process.env[a.env]) || a.defaultValue;
                });
                result = this.parseInternal(2, params, root, root);   
                if(result && !result.err) 
                {
                    if(!result.verb) return params;
                }   
            }
            catch(err) {
                console.log(err);
                return;
            } 
        }
        
        if(result && result.err && result.err !== "?") 
        {
            console.log(result.err);
            if(!result.showUsage)
                return;
        }
        
        this.showUsage(options && Object.getPrototypeOf(options).$section, result && result.section, result && result.verb);
        return;
    }
    
    private parseInternal(start:number, params, root:Section, section?:Section)
    {     
        let verb:Section;
		for(var i=start;i< process.argv.length;i++)
        {          
            let k = process.argv[i];
            // Check section
            if((section||root).sections) {
                var newSection = (section||root).sections[k];
                if(newSection) 
                {
                   newSection = (<any>newSection).$section;
                   if(newSection.arguments) {
                        newSection.arguments.forEach(a => 
                        {
                            if(a.defaultValue || a.env)
                                params[a.name] = (a.env && process.env[a.env]) || a.defaultValue;
                        })
                    }
                    return this.parseInternal(i+1, params, root, newSection);
                }
            }
                
            // Check verb
            let defaultArgument = null;
            if((section||root).sections && !verb) {
                verb = (section||root).sections["$verb_" + k];
                if(verb) {
                    verb = (<any>verb).$section;
                    if(verb.arguments) {
                        verb.arguments.forEach(a =>
                        {
                            if(a.defaultValue || a.env)
                                params[a.name] = (a.env && process.env[a.env]) || a.defaultValue;
                            if(a.defaultArgument)
                                defaultArgument = a.alias;
                        })
                    }
                    
                    if(!defaultArgument)
                        continue;
                    
                    k = defaultArgument;
                }
            }
        
            if( k === "--help" || k ==="-?") 
            {
				return {verb:verb, section:section, err:"?"}               
            }
            
			let v=null;
			if(k.indexOf("=") > 0) 
            {
				var parts = k.split("=");
				k = parts[0];
				v = parts[1];
			}
            
			let flags;
            if(verb)
                flags = verb.arguments.filter( a => a.alias === k || a.longAlias === k );
            if((!flags || flags.length===0) && section)
                flags = section.arguments.filter( a => a.alias === k || a.longAlias === k );
            if((!flags || flags.length===0))
                flags = root.arguments.filter( a => a.alias === k || a.longAlias === k );
                
			if(!flags || flags.length == 0) 
            {
                if(section || verb)
				    console.log("flag provide but not defined : " + k);
				return;
			}
			
            let flag:Argument = flags[0];
			let next = v || (flag.env && process.env[flag.env])|| flag.defaultValue;
			if(!v) 
            {
				if(i < process.argv.length) 
                {
					v = process.argv[i+1];
					if(v && v[0] !== "-") 
                    {
						i++;
                        try {
					       next = this.checkType(k, v, flag.type);
                        }
                        catch(err) {
                            return {verb:verb, section:section, err:err}               
                        }
					}
					else if(flag.type === "boolean") 
                    {
						next = true
					}
				}
			}
			
            if(next==undefined) 
                return {verb:verb, section:section, showUsage:true, err: defaultArgument ? flag.name + " required an argument." : "flag needs an argument : " + k};               
                            
			if(flag.multiple) {
                params[flag.name] = params[flag.name] || {};
				params[flag.name].push(next);
            }
			else {	
                if(flag.set)
                    return {verb:verb, section:section, err: "Multiple occurences of " + k};                           
				params[flag.name] = next;
            }
            flag.set=true;
		}
		
		return {verb:verb, section:section};
	}
	
	private checkType(name:string, val:string, type:string):any 
    {
		switch(type) 
        {
			case "string": 
				if(val) {
					if(val.length > 0 && val[0] === '"') val = val.substr(1);
					if(val.length > 0 && val[val.length-1] === '"') val = val.substr(val.length-1);
				};
				return val;
			case "boolean":
				if( val !== "true" && val !== "false")
					throw "Invalid boolean value (true/false) for " + name;
				return val === "true";
			case "number":
				var num = parseInt(val);
				if( num === NaN)
					throw "Invalid number value for " + name;
				return num;
			case "verb":
				return val;
		}	
	}

    private showOptions(section:Section) 
    {
        if( section.arguments && section.arguments.length > 0) {
            console.log("");
            console.log("Options:");
            let table = new Table();
            for(let arg of section.arguments) 
            {
                if(arg.defaultArgument) continue;
                let name = arg.alias;
                if(arg.longAlias)
                    name = name + ', ' + arg.longAlias;
                let flag=false;
                if(arg.env) {
                    flag=true;
                    name = name + "=[" + arg.env + "]";
                }
                if(arg.defaultValue) {
                    name = name + (flag ? "|":"=") + arg.defaultValue;
                }
                table.cell("margin", "  ");
                table.cell("name", name);
                table.cell("desc", arg.description);
                table.newRow();
            }      
            console.log(table.print());
        }        
    }
    
    private toArray(list):Array<any> {
        var result=[];
        if(list) {
            for(var p in list) {
                if(list.hasOwnProperty(p))
                    result.push(list[p]);
            }
        }
        return result;
    }
    
    private showCommands(section:Section) 
    {
        var sections = this.toArray(section.sections); 
        if( sections && sections.length > 0) {
            console.log("");                    
            console.log("Commands:");
            let table = new Table();
            for(let cmd of sections)
            {
                table.cell("margin", "    ");
                table.cell("name", (<any>cmd).$section.name);
                table.cell("desc", (<any>cmd).$section.description);
                table.newRow();
            }      
            console.log(table.print());
        }        
    }
    
    private showSections(root:Section) 
    {
        var sections = this.toArray(root.sections); 
        console.log(`Usage: ${this.name}${root.arguments.length > 0 ? " [OPTIONS]":""} COMMAND ${sections && sections.length>0?"[args...]":""}`)
        console.log(`       ${this.name} [--help]`);
        console.log("");        
        console.log(this.description);

        this.showOptions(root);
        this.showCommands(root);

        console.log(`Run '${this.name} COMMAND --help' for more information on a command.`);
    }
    
    private showCommand(root:Section, section:Section) 
    {
        var sections = this.toArray(section.sections);         
        console.log(`Usage: ${this.name} ${section.name}${section.arguments.length > 0 ? " [OPTIONS]":""} COMMAND ${sections && sections.length>0?"[args...]":""}`)
        console.log("");        
        console.log(section.description);

        this.showOptions(section);
        this.showCommands(section);

        console.log(`Run '${this.name} ${section.name} COMMAND --help' for more information on a command.`);        
    }
    
    private showVerb( root:Section, section:Section, verb:Section) 
    {
        let name = (section || root).name ? (section || root).name + " " : "";
        console.log(`Usage: ${this.name} ${name}${verb.name}${verb.arguments && verb.arguments.length > 0 ? " [OPTIONS]":""}`)
        console.log();        
        console.log(verb.description);
        
        this.showOptions(verb);
        this.showCommands(verb);       
    }
    
	private showUsage(root:Section, section:Section, verb:Section) 
    { 
        if(!verb && !section) {
            this.showSections(root);
            return;
        }
        
        if(!verb) {
            this.showCommand(root, section);
            return; 
        }
        
        this.showVerb( root, section, verb);
	}
}